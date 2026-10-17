// Same-origin Canvas API client. It rides the teacher's logged-in session, so it
// never stores an API token. Writes send the CSRF token Canvas puts in the
// `_csrf_token` cookie, read fresh on every request because Canvas rotates it.
//
// The client has no browser dependencies of its own: fetch, the cookie reader
// and the sleep function are injected, which keeps it unit-testable in Node.

import { nextPageUrl } from './linkHeader'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CanvasClientOptions {
  /** Origin of the Canvas instance, e.g. https://school.instructure.com. */
  baseUrl: string
  fetch: FetchLike
  /** Returns the raw document.cookie string. */
  readCookies: () => string
  sleep?: (ms: number) => Promise<void>
  /** Maximum attempts for a throttled (403 rate limit) or 5xx request. */
  maxRetries?: number
  /** Below this X-Rate-Limit-Remaining value the client pauses between writes. */
  lowWaterMark?: number
}

export class CanvasApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
    this.name = 'CanvasApiError'
  }
}

export interface Progress {
  id: number
  workflow_state: 'queued' | 'running' | 'completed' | 'failed'
  completion?: number | null
  message?: string | null
  url?: string
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function csrfTokenFrom(cookies: string): string | null {
  for (const part of cookies.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === '_csrf_token') return decodeURIComponent(rest.join('='))
  }
  return null
}

export class CanvasClient {
  private readonly baseUrl: string
  private readonly doFetch: FetchLike
  private readonly readCookies: () => string
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRetries: number
  private readonly lowWaterMark: number
  /** Writes run strictly one at a time; this is the tail of that queue. */
  private writeQueue: Promise<unknown> = Promise.resolve()
  /** Last X-Rate-Limit-Remaining seen, or null before the first response. */
  rateLimitRemaining: number | null = null

  constructor(opts: CanvasClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.doFetch = opts.fetch
    this.readCookies = opts.readCookies
    this.sleep = opts.sleep ?? defaultSleep
    this.maxRetries = opts.maxRetries ?? 4
    this.lowWaterMark = opts.lowWaterMark ?? 150
  }

  url(path: string): string {
    if (/^https?:\/\//.test(path)) return path
    return `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`
  }

  async get<T>(path: string): Promise<T> {
    return (await this.request<T>('GET', path)).data
  }

  /** Follows Link: rel="next" until exhausted and concatenates the pages. */
  async getAll<T>(path: string): Promise<T[]> {
    const out: T[] = []
    let next: string | null = this.url(withPerPage(path))
    while (next) {
      const { data, response }: { data: T[]; response: Response } = await this.request<T[]>('GET', next)
      out.push(...data)
      next = nextPageUrl(response.headers.get('Link'))
    }
    return out
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.enqueueWrite(() => this.request<T>('PUT', path, body).then(r => r.data))
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.enqueueWrite(() => this.request<T>('POST', path, body).then(r => r.data))
  }

  delete<T>(path: string): Promise<T> {
    return this.enqueueWrite(() => this.request<T>('DELETE', path).then(r => r.data))
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.post<{ data?: T; errors?: { message: string }[] }>('/api/graphql', { query, variables })
    if (result.errors?.length) {
      throw new CanvasApiError(result.errors.map(e => e.message).join('; '), 200, result)
    }
    return result.data as T
  }

  /** Polls a Progress object until it completes or fails. */
  async waitForProgress(progress: Progress, onUpdate?: (p: Progress) => void, intervalMs = 1000): Promise<Progress> {
    let current = progress
    while (current.workflow_state === 'queued' || current.workflow_state === 'running') {
      onUpdate?.(current)
      await this.sleep(intervalMs)
      current = await this.get<Progress>(`/api/v1/progress/${current.id}`)
    }
    onUpdate?.(current)
    if (current.workflow_state === 'failed') {
      throw new CanvasApiError(current.message || 'Canvas reported the job as failed', 200, current)
    }
    return current
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(async () => {
      if (this.rateLimitRemaining !== null && this.rateLimitRemaining < this.lowWaterMark) {
        // The bucket refills at roughly 10 units a second; give it room.
        await this.sleep(2000)
      }
      return fn()
    })
    // Keep the queue alive even when a write fails.
    this.writeQueue = run.catch(() => undefined)
    return run
  }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<{ data: T; response: Response }> {
    const headers: Record<string, string> = { Accept: 'application/json+canvas-string-ids, application/json' }
    if (method !== 'GET') {
      const token = csrfTokenFrom(this.readCookies())
      if (token) headers['X-CSRF-Token'] = token
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    for (let attempt = 0; ; attempt++) {
      const response = await this.doFetch(this.url(path), {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const remaining = response.headers.get('X-Rate-Limit-Remaining')
      if (remaining !== null && remaining !== '') this.rateLimitRemaining = Number(remaining)

      if (response.ok) {
        const text = await response.text()
        return { data: (text ? JSON.parse(text) : null) as T, response }
      }

      const text = await response.text()
      const throttled = response.status === 403 && /rate limit exceeded/i.test(text)
      const retryable = throttled || response.status >= 500
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(500 * 2 ** attempt)
        continue
      }
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // keep raw text
      }
      throw new CanvasApiError(`${method} ${path} failed with ${response.status}`, response.status, parsed)
    }
  }
}

function withPerPage(path: string): string {
  if (/[?&]per_page=/.test(path)) return path
  return `${path}${path.includes('?') ? '&' : '?'}per_page=100`
}
