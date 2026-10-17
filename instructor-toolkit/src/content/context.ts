// Everything a feature needs about the page it is running on.

import { CanvasClient } from '../core/canvasClient'

export interface PageContext {
  client: CanvasClient
  host: string
  origin: string
  courseId: string
  /** IANA time zone used for date arithmetic; the user's Canvas setting when known. */
  timeZone: string
  route: 'speedgrader' | 'modules' | 'assignments' | 'course'
}

export function parseRoute(pathname: string): { courseId: string; route: PageContext['route'] } | null {
  const m = pathname.match(/^\/courses\/(\d+)(\/[^?#]*)?/)
  if (!m) return null
  const rest = m[2] ?? ''
  const route: PageContext['route'] = /\/gradebook\/speed_grader/.test(rest)
    ? 'speedgrader'
    : rest.startsWith('/modules')
      ? 'modules'
      : rest.startsWith('/assignments')
        ? 'assignments'
        : 'course'
  return { courseId: m[1]!, route }
}

export function createClient(origin: string): CanvasClient {
  return new CanvasClient({
    baseUrl: origin,
    fetch: (input, init) => fetch(input, init),
    readCookies: () => document.cookie,
  })
}

/** Canvas user time zone, falling back to the browser's. */
export async function detectTimeZone(client: CanvasClient): Promise<string> {
  try {
    const profile = await client.get<{ time_zone?: string }>('/api/v1/users/self/profile')
    if (profile.time_zone) {
      // Validate: Intl throws for unknown zones.
      new Intl.DateTimeFormat('en-US', { timeZone: profile.time_zone })
      return profile.time_zone
    }
  } catch {
    // fall through
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
