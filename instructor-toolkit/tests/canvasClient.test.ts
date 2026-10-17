import { CanvasClient, csrfTokenFrom } from '../src/core/canvasClient'
import { nextPageUrl } from '../src/core/linkHeader'

function res(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200, headers: init.headers })
}

describe('linkHeader', () => {
  it('finds the next page', () => {
    const h = '<https://x.test/api/v1/a?page=1>; rel="current",<https://x.test/api/v1/a?page=2>; rel="next",<https://x.test/api/v1/a?page=9>; rel="last"'
    expect(nextPageUrl(h)).toBe('https://x.test/api/v1/a?page=2')
    expect(nextPageUrl('<https://x.test/a>; rel="last"')).toBeNull()
    expect(nextPageUrl(null)).toBeNull()
  })
})

describe('CanvasClient', () => {
  it('reads and decodes the CSRF cookie', () => {
    expect(csrfTokenFrom('a=1; _csrf_token=abc%2B%3D; b=2')).toBe('abc+=')
    expect(csrfTokenFrom('a=1')).toBeNull()
  })

  it('follows pagination and adds per_page', async () => {
    const calls: string[] = []
    const fetch = vi.fn(async (url: string) => {
      calls.push(url)
      return url.includes('page=2') ? res([3]) : res([1, 2], { headers: { Link: '<https://x.test/api/v1/things?page=2>; rel="next"' } })
    })
    const client = new CanvasClient({ baseUrl: 'https://x.test', fetch, readCookies: () => '' })
    expect(await client.getAll<number>('/api/v1/things')).toEqual([1, 2, 3])
    expect(calls[0]).toBe('https://x.test/api/v1/things?per_page=100')
  })

  it('sends the CSRF token on writes only, read fresh each time', async () => {
    let cookie = '_csrf_token=one'
    const seen: (string | undefined)[] = []
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)['X-CSRF-Token'])
      return res({})
    })
    const client = new CanvasClient({ baseUrl: 'https://x.test', fetch, readCookies: () => cookie })
    await client.get('/a')
    await client.put('/a', {})
    cookie = '_csrf_token=two'
    await client.post('/a', {})
    expect(seen).toEqual([undefined, 'one', 'two'])
  })

  it('retries when throttled, then gives up with an error', async () => {
    const sleep = vi.fn(async () => {})
    let n = 0
    const fetch = vi.fn(async () => (++n < 3 ? res('403 Forbidden (Rate Limit Exceeded)', { status: 403 }) : res({ ok: true })))
    const client = new CanvasClient({ baseUrl: 'https://x.test', fetch, readCookies: () => '', sleep })
    expect(await client.get('/a')).toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledTimes(2)

    const failing = new CanvasClient({ baseUrl: 'https://x.test', fetch: async () => res({ errors: 'nope' }, { status: 404 }), readCookies: () => '', sleep })
    await expect(failing.get('/a')).rejects.toMatchObject({ status: 404 })
  })

  it('runs writes one at a time', async () => {
    let active = 0
    let max = 0
    const fetch = vi.fn(async () => {
      active++
      max = Math.max(max, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return res({})
    })
    const client = new CanvasClient({ baseUrl: 'https://x.test', fetch, readCookies: () => '' })
    await Promise.all([client.put('/a', {}), client.put('/b', {}), client.post('/c', {})])
    expect(max).toBe(1)
  })

  it('polls a Progress job to completion', async () => {
    const states = ['running', 'completed']
    const client = new CanvasClient({
      baseUrl: 'https://x.test',
      fetch: async () => res({ id: 1, workflow_state: states.shift() }),
      readCookies: () => '',
      sleep: async () => {},
    })
    const p = await client.waitForProgress({ id: 1, workflow_state: 'queued' })
    expect(p.workflow_state).toBe('completed')
  })
})
