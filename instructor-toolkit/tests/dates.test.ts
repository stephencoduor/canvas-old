import { addLocalDays, fromLocalParts, localWeekday, setLocalDate, shiftDate, toLocalParts } from '../src/core/dates'

const NY = 'America/New_York'

describe('dates', () => {
  it('round-trips wall-clock time', () => {
    const d = fromLocalParts({ year: 2026, month: 9, day: 14, hour: 23, minute: 59, second: 59 }, NY)
    expect(d.toISOString()).toBe('2026-09-15T03:59:59.000Z')
    expect(toLocalParts(d, NY)).toMatchObject({ day: 14, hour: 23, minute: 59 })
  })

  it('keeps wall time across a DST change', () => {
    // 2026-11-01 is the end of DST in New York.
    const before = new Date('2026-10-30T03:59:00Z') // Oct 29, 23:59 EDT
    const after = addLocalDays(before, 7, NY)
    expect(toLocalParts(after, NY)).toMatchObject({ month: 11, day: 5, hour: 23, minute: 59 })
    expect(after.toISOString()).toBe('2026-11-06T04:59:00.000Z')
  })

  it('shifts backwards', () => {
    expect(shiftDate('2026-09-15T03:59:59Z', { days: -7, weekendPolicy: 'keep' }, NY)).toBe('2026-09-08T03:59:59Z')
  })

  it('never invents a date', () => {
    expect(shiftDate(null, { days: 3, weekendPolicy: 'keep' }, NY)).toBeNull()
  })

  it('moves weekend dates off the weekend', () => {
    // Friday 2026-09-18 23:59 local + 1 day = Saturday
    const fri = '2026-09-19T03:59:00Z'
    expect(localWeekday(new Date(shiftDate(fri, { days: 1, weekendPolicy: 'next-weekday' }, NY)!), NY)).toBe(1)
    expect(localWeekday(new Date(shiftDate(fri, { days: 1, weekendPolicy: 'previous-weekday' }, NY)!), NY)).toBe(5)
  })

  it('remaps a weekly pattern and sets a time', () => {
    const tue = '2026-09-15T14:00:00Z' // Tuesday 10:00 EDT
    const out = shiftDate(tue, { days: 0, weekdayMap: { 2: 1 }, setTime: '23:59', weekendPolicy: 'keep' }, NY)!
    const p = toLocalParts(new Date(out), NY)
    expect(localWeekday(new Date(out), NY)).toBe(1)
    expect(p).toMatchObject({ day: 14, hour: 23, minute: 59, second: 59 })
  })

  it('sets an absolute date keeping the time of day', () => {
    expect(setLocalDate('2026-09-15T03:59:59Z', '2027-01-20', NY)).toBe('2027-01-21T04:59:59Z')
    expect(setLocalDate(null, '2027-01-20', NY)).toBe('2027-01-21T04:59:59Z')
  })
})
