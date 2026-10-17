import { normalizeHost, resolveFeatures } from '../src/core/features'

describe('resolveFeatures', () => {
  it('lets managed policy override the user', () => {
    const r = resolveFeatures({ auditor: true, keyboardFlow: true }, { auditor: false })
    expect(r.enabled.auditor).toBe(false)
    expect(r.enabled.keyboardFlow).toBe(true)
    expect(r.enabled.datesEditor).toBe(true)
    expect(r.managed).toEqual({ auditor: false })
  })
})

describe('normalizeHost', () => {
  it('accepts hosts and URLs, rejects junk', () => {
    expect(normalizeHost(' https://Canvas.School.edu/courses/1 ')).toBe('canvas.school.edu')
    expect(normalizeHost('not a host')).toBeNull()
    expect(normalizeHost('')).toBeNull()
  })
})
