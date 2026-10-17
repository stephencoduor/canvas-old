import { applyDateChanges, planDateChanges, snapshotOf, validateChanges } from '../src/core/bulkDates'
import type { DatedItem } from '../src/core/courseModel'
import { CanvasClient } from '../src/core/canvasClient'

const TZ = 'UTC'

function item(over: Partial<DatedItem> = {}): DatedItem {
  return {
    key: 'assignment:1',
    kind: 'Assignment',
    title: 'Essay',
    moduleId: 'm1',
    moduleName: 'Week 1',
    order: [1, 1],
    published: true,
    pointsPossible: 10,
    assignmentId: '1',
    postToSis: false,
    base: { due_at: '2026-09-10T23:59:00Z', unlock_at: '2026-09-01T00:00:00Z', lock_at: null },
    overrides: [{ id: 'o1', title: 'Section B', due_at: '2026-09-12T23:59:00Z', unlock_at: null, lock_at: null }],
    overridesKnown: true,
    fields: ['due_at', 'unlock_at', 'lock_at'],
    write: { kind: 'assignment', assignmentId: '1' },
    htmlUrl: null,
    ...over,
  }
}

describe('planDateChanges', () => {
  it('shifts selected fields and overrides', () => {
    const [ch] = planDateChanges([item()], { op: 'shift', rule: { days: 7, weekendPolicy: 'keep' } }, { fields: ['due_at'], includeOverrides: true, timeZone: TZ })
    expect(ch!.after).toEqual({ due_at: '2026-09-17T23:59:00Z', unlock_at: '2026-09-01T00:00:00Z', lock_at: null })
    expect(ch!.overrides[0]!.after.due_at).toBe('2026-09-19T23:59:00Z')
  })

  it('leaves overrides alone when asked', () => {
    const [ch] = planDateChanges([item()], { op: 'shift', rule: { days: 1, weekendPolicy: 'keep' } }, { fields: ['due_at'], includeOverrides: false, timeZone: TZ })
    expect(ch!.overrides).toEqual([])
  })

  it('skips items with nothing to change', () => {
    const changes = planDateChanges([item({ base: { due_at: null, unlock_at: null, lock_at: null }, overrides: [] })], { op: 'shift', rule: { days: 3, weekendPolicy: 'keep' } }, { fields: ['due_at'], includeOverrides: true, timeZone: TZ })
    expect(changes).toEqual([])
  })

  it('restores a snapshot exactly', () => {
    const original = item()
    const snap = snapshotOf(original)
    const moved = item({ base: { due_at: '2026-10-01T00:00:00Z', unlock_at: null, lock_at: null }, overrides: [{ ...original.overrides[0]!, due_at: null }] })
    const [ch] = planDateChanges([moved], { op: 'restore', snapshot: snap }, { fields: [], includeOverrides: false, timeZone: TZ })
    expect(ch!.after).toEqual(original.base)
    expect(ch!.overrides[0]!.after.due_at).toBe('2026-09-12T23:59:00Z')
  })

  it('flags date orders Canvas rejects', () => {
    const changes = planDateChanges([item()], { op: 'shift', rule: { days: 30, weekendPolicy: 'keep' } }, { fields: ['unlock_at'], includeOverrides: false, timeZone: TZ })
    expect(validateChanges(changes)[0]!.problem).toMatch(/after the due date/)
  })
})

describe('applyDateChanges', () => {
  it('sends assignments through bulk_update and others through their own endpoints', async () => {
    const requests: { url: string; method?: string; body?: unknown }[] = []
    const fetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/bulk_update')) return new Response(JSON.stringify({ id: 9, workflow_state: 'completed' }))
      return new Response('{}')
    }
    const client = new CanvasClient({ baseUrl: 'https://x.test', fetch, readCookies: () => '', sleep: async () => {} })
    const quiz = item({ key: 'quiz:5', kind: 'Quiz', assignmentId: null, overrides: [], write: { kind: 'quiz', quizId: '5' } })
    const mod = item({ key: 'module:2', kind: 'Module', assignmentId: null, overrides: [], fields: ['unlock_at'], write: { kind: 'module', moduleId: '2' } })
    const changes = planDateChanges([item(), quiz, mod], { op: 'shift', rule: { days: 1, weekendPolicy: 'keep' } }, { fields: ['due_at', 'unlock_at'], includeOverrides: true, timeZone: TZ })
    const result = await applyDateChanges(client, '42', changes)
    expect(result.failed).toEqual([])
    expect(result.applied).toHaveLength(3)
    const bulk = requests.find(r => r.url.endsWith('/bulk_update'))!
    expect(bulk.body).toEqual([
      {
        id: '1',
        all_dates: [
          { base: true, due_at: '2026-09-11T23:59:00Z', unlock_at: '2026-09-02T00:00:00Z', lock_at: null },
          { id: 'o1', due_at: '2026-09-13T23:59:00Z', unlock_at: null, lock_at: null },
        ],
      },
    ])
    expect(requests.some(r => r.url.endsWith('/quizzes/5/date_details') && r.method === 'PUT')).toBe(true)
    expect(requests.find(r => r.url.endsWith('/modules/2'))!.body).toEqual({ module: { unlock_at: '2026-09-02T00:00:00Z' } })
  })

  it('reports per-assignment failures from the Progress results', async () => {
    const fetch = async () => new Response(JSON.stringify({ id: 9, workflow_state: 'completed', results: [{ assignment_id: 1, errors: { due_at: ['closed grading period'] } }] }))
    const client = new CanvasClient({ baseUrl: 'https://x.test', fetch, readCookies: () => '', sleep: async () => {} })
    const changes = planDateChanges([item()], { op: 'shift', rule: { days: 1, weekendPolicy: 'keep' } }, { fields: ['due_at'], includeOverrides: false, timeZone: TZ })
    const result = await applyDateChanges(client, '42', changes)
    expect(result.failed[0]!.error).toMatch(/closed grading period/)
  })
})
