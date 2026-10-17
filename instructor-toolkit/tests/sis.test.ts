import { planSis, setPostToSis, DEFAULT_SIS_RULES } from '../src/core/sis'
import type { DatedItem } from '../src/core/courseModel'
import { CanvasClient } from '../src/core/canvasClient'

const base = (over: Partial<DatedItem>): DatedItem => ({
  key: 'a',
  kind: 'Assignment',
  title: 'Quiz 1',
  moduleId: null,
  moduleName: null,
  order: [0, 0],
  published: true,
  pointsPossible: 10,
  assignmentId: '1',
  postToSis: false,
  base: { due_at: '2026-09-10T00:00:00Z', unlock_at: null, lock_at: null },
  overrides: [],
  overridesKnown: true,
  fields: ['due_at'],
  write: { kind: 'assignment', assignmentId: '1' },
  htmlUrl: null,
  ...over,
})

describe('planSis', () => {
  it('blocks items Canvas would refuse to sync', () => {
    const plan = planSis(
      [
        base({ key: 'ok' }),
        base({ key: 'nodue', base: { due_at: null, unlock_at: null, lock_at: null } }),
        base({ key: 'long', title: 'x'.repeat(300) }),
        base({ key: 'already', postToSis: true }),
        base({ key: 'section', overrides: [{ id: 'o', title: 'B', due_at: null, unlock_at: null, lock_at: null }] }),
        base({ key: 'ungraded', pointsPossible: null }),
        base({ key: 'quiz', assignmentId: null }),
      ],
      true,
      DEFAULT_SIS_RULES,
    )
    expect(plan.change.map(i => i.key)).toEqual(['ok'])
    expect(plan.unchanged.map(i => i.key)).toEqual(['already'])
    expect(plan.blocked.map(b => b.item.key)).toEqual(['nodue', 'long', 'section', 'ungraded'])
  })

  it('never blocks turning sync off', () => {
    const plan = planSis([base({ postToSis: true, base: { due_at: null, unlock_at: null, lock_at: null } })], false, DEFAULT_SIS_RULES)
    expect(plan.change).toHaveLength(1)
  })
})

describe('setPostToSis', () => {
  it('falls back to REST when GraphQL fails', async () => {
    const urls: string[] = []
    const fetch = async (url: string) => {
      urls.push(url)
      if (url.endsWith('/api/graphql')) return new Response(JSON.stringify({ errors: [{ message: 'not allowed' }] }))
      return new Response('{}')
    }
    const client = new CanvasClient({ baseUrl: 'https://x.test', fetch, readCookies: () => '' })
    await setPostToSis(client, '42', '7', true)
    expect(urls).toEqual(['https://x.test/api/graphql', 'https://x.test/api/v1/courses/42/assignments/7'])
  })
})
