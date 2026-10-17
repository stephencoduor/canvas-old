import { assessmentPayload, keyToAction, newDraft, reduce, total } from '../src/core/rubric'

const criteria = [
  { id: 'c1', description: 'Thesis', points: 4, ratings: [{ id: 'r0', points: 0, description: 'None' }, { id: 'r4', points: 4, description: 'Full' }, { id: 'r2', points: 2, description: 'Some' }] },
  { id: 'c2', description: 'Evidence', points: 6, ratings: [{ id: 'e6', points: 6, description: 'Full' }, { id: 'e3', points: 3, description: 'Half' }] },
]

describe('rubric reducer', () => {
  it('orders ratings highest first and advances after rating', () => {
    let d = newDraft(criteria)
    d = reduce(d, { type: 'rate', n: 2 })
    expect(d.scores.c1).toMatchObject({ points: 2, ratingId: 'r2' })
    expect(d.focus).toBe(1)
    d = reduce(d, { type: 'half' })
    expect(d.scores.c2).toMatchObject({ points: 3, ratingId: 'e3' })
    expect(total(d)).toBe(5)
  })

  it('gives full marks everywhere', () => {
    const d = reduce(newDraft(criteria), { type: 'full' })
    expect(total(d)).toBe(10)
    expect(assessmentPayload(d)).toEqual({ rubric_assessment: { c1: { points: 4, rating_id: 'r4' }, c2: { points: 6, rating_id: 'e6' } } })
  })

  it('keeps existing scores and comments', () => {
    const d = newDraft(criteria, { c2: { points: 3, comments: 'ok' } })
    expect(assessmentPayload(d).rubric_assessment.c2).toEqual({ points: 3, comments: 'ok' })
  })

  it('maps keys', () => {
    const k = (key: string, altKey = false) => keyToAction({ key, altKey, ctrlKey: false, metaKey: false, shiftKey: false })
    expect(k('3')).toEqual({ type: 'rate', n: 3 })
    expect(k('f', true)).toEqual({ type: 'full' })
    expect(k('ArrowDown')).toEqual({ type: 'next' })
    expect(k('a')).toBeNull()
    expect(keyToAction({ key: '1', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBeNull()
  })
})
