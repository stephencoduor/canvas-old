import { runAudit, applyFixes, findingsToCsv } from '../src/core/audit/auditor'
import { CanvasClient } from '../src/core/canvasClient'

const ORIGIN = 'https://school.instructure.com'

/** Minimal fake Canvas keyed by path (query string ignored unless listed). */
function fakeCanvas(routes: Record<string, unknown>, writes: { url: string; body: unknown }[] = []) {
  return new CanvasClient({
    baseUrl: ORIGIN,
    readCookies: () => '',
    sleep: async () => {},
    fetch: async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      const key = u.searchParams.get('only_announcements') ? `${u.pathname}?announcements` : u.pathname
      if (init?.method && init.method !== 'GET') {
        writes.push({ url: u.pathname, body: init.body ? JSON.parse(String(init.body)) : null })
        return new Response('{}')
      }
      if (!(key in routes)) return new Response('{"errors":"not found"}', { status: 404 })
      return new Response(JSON.stringify(routes[key]))
    },
  })
}

const routes = {
  '/api/v1/courses/2': { id: '2', name: 'Biology Fall', start_at: '2026-09-01T00:00:00Z', end_at: null, syllabus_body: '<a href="/courses/1">old course home</a>' },
  '/api/v1/courses/2/pages': [
    { url: 'week-1', title: 'Week 1', html_url: '/courses/2/pages/week-1', body: '<a href="/courses/1/pages/week-1">Week 1 notes</a> <a href="/courses/1/files/10">Lab sheet</a> <a href="/courses/2/files/30">Hidden</a> <a href="/courses/2/files/404">Gone</a>' },
  ],
  '/api/v1/courses/2/assignments': [
    { id: '5', name: 'Essay', description: '<iframe src="/courses/2/external_tools/retrieve?url=https%3A%2F%2Fassignments.google.com%2Fx"></iframe>', html_url: '/courses/2/assignments/5', due_at: '2026-03-01T00:00:00Z', unlock_at: null },
  ],
  '/api/v1/courses/2/discussion_topics': [],
  '/api/v1/courses/2/discussion_topics?announcements': [],
  '/api/v1/courses/2/quizzes': [],
  '/api/v1/courses/2/files': [
    { id: '20', display_name: 'lab.pdf', filename: 'lab.pdf', size: 1, locked: false, hidden: false },
    { id: '30', display_name: 'secret.pdf', filename: 'secret.pdf', size: 1, locked: true, hidden: false },
  ],
  '/api/v1/courses/2/modules': [{ id: 'm', name: 'Week 1', published: true, items_count: 1, items: [{ id: 'i', title: 'Draft page', type: 'Page', published: false }] }],
  '/api/v1/files/10': { id: '10', display_name: 'lab.pdf' },
}

describe('runAudit', () => {
  it('finds each kind of problem and proposes safe fixes', async () => {
    const report = await runAudit(fakeCanvas(routes), '2', { canvasOrigin: ORIGIN, useNativeValidator: false, resolveFixes: true })
    const byCat = (c: string) => report.findings.filter(f => f.category === c)
    expect(byCat('old-course-link')).toHaveLength(3)
    expect(byCat('unpublished-file')).toHaveLength(1)
    expect(byCat('missing-file')).toHaveLength(1)
    expect(byCat('third-party-tool')[0]!.detail).toMatch(/Google/)
    expect(byCat('unpublished-in-module')).toHaveLength(1)
    expect(byCat('stale-date')).toHaveLength(1)
    const fixes = report.findings.filter(f => f.fix).map(f => [f.fix!.from, f.fix!.to])
    expect(fixes).toEqual(
      expect.arrayContaining([
        ['/courses/1/pages/week-1', '/courses/2/pages/week-1'],
        ['/courses/1/files/10', '/courses/2/files/20'],
        ['/courses/1', '/courses/2'],
      ]),
    )
    expect(findingsToCsv(report).split('\r\n')[0]).toContain('Severity')
  })

  it('applies all fixes for one page in a single write', async () => {
    const writes: { url: string; body: unknown }[] = []
    const client = fakeCanvas({ ...routes, '/api/v1/courses/2/pages/week-1': { body: (routes['/api/v1/courses/2/pages'] as { body: string }[])[0]!.body } }, writes)
    const report = await runAudit(client, '2', { canvasOrigin: ORIGIN, useNativeValidator: false, resolveFixes: true })
    const pageFixes = report.findings.filter(f => f.fix && f.location.type === 'page')
    const res = await applyFixes(client, '2', pageFixes)
    expect(res.failed).toEqual([])
    expect(writes).toHaveLength(1)
    const body = (writes[0]!.body as { wiki_page: { body: string } }).wiki_page.body
    expect(body).toContain('/courses/2/pages/week-1')
    expect(body).toContain('/courses/2/files/20')
    expect(body).not.toContain('/courses/1/')
  })
})
