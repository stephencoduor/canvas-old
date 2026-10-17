// Date arithmetic in the teacher's Canvas time zone. Canvas stores and returns
// UTC ISO strings, but "move this to Monday at 11:59pm" only makes sense in
// wall-clock time, and shifting across a DST change must keep that wall time.

export interface LocalParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

export function toLocalParts(date: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {}
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  }
}

/** Offset of the zone from UTC at the given instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const p = toLocalParts(new Date(instant), timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** Converts a wall-clock time in a zone to a UTC Date. Non-existent DST times roll forward. */
export function fromLocalParts(p: LocalParts, timeZone: string): Date {
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  let guess = naive - offsetAt(naive, timeZone)
  guess = naive - offsetAt(guess, timeZone)
  return new Date(guess)
}

/** Day of week (0 = Sunday) of the date as seen in the zone. */
export function localWeekday(date: Date, timeZone: string): number {
  const p = toLocalParts(date, timeZone)
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

export function addLocalDays(date: Date, days: number, timeZone: string): Date {
  const p = toLocalParts(date, timeZone)
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return fromLocalParts(
    { ...p, year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() },
    timeZone,
  )
}

export type WeekendPolicy = 'keep' | 'next-weekday' | 'previous-weekday'

export interface ShiftRule {
  /** Whole days to move, negative to move earlier. */
  days: number
  /** Optional wall-clock time to set, "HH:MM" in the course time zone. */
  setTime?: string
  /** Remap weekdays after the day shift, e.g. {2: 1, 4: 3} turns Tue/Thu into Mon/Wed. */
  weekdayMap?: Partial<Record<number, number>>
  weekendPolicy: WeekendPolicy
}

/** Applies a shift rule to one ISO date. Null stays null: the tool never invents dates. */
export function shiftDate(iso: string | null, rule: ShiftRule, timeZone: string): string | null {
  if (!iso) return null
  let date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  if (rule.days) date = addLocalDays(date, rule.days, timeZone)

  if (rule.weekdayMap) {
    const from = localWeekday(date, timeZone)
    const to = rule.weekdayMap[from]
    if (to !== undefined && to !== from) date = addLocalDays(date, to - from, timeZone)
  }

  if (rule.weekendPolicy !== 'keep') {
    const wd = localWeekday(date, timeZone)
    if (wd === 6 || wd === 0) {
      const forward = rule.weekendPolicy === 'next-weekday'
      const delta = forward ? (wd === 6 ? 2 : 1) : wd === 6 ? -1 : -2
      date = addLocalDays(date, delta, timeZone)
    }
  }

  if (rule.setTime) {
    const m = rule.setTime.match(/^(\d{1,2}):(\d{2})$/)
    if (m) {
      const p = toLocalParts(date, timeZone)
      date = fromLocalParts({ ...p, hour: Number(m[1]), minute: Number(m[2]), second: m[2] === '59' ? 59 : 0 }, timeZone)
    }
  }

  return date.toISOString().replace('.000Z', 'Z')
}

/** Sets an absolute local date, keeping the original wall-clock time (or 23:59 when there was none). */
export function setLocalDate(iso: string | null, ymd: string, timeZone: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  const base = iso ? toLocalParts(new Date(iso), timeZone) : { hour: 23, minute: 59, second: 59 }
  return fromLocalParts({ year: y, month: m, day: d, hour: base.hour, minute: base.minute, second: base.second }, timeZone)
    .toISOString()
    .replace('.000Z', 'Z')
}

/** Short human label for previews, in the course time zone. */
export function formatLocal(iso: string | null, timeZone: string, locale = 'en-US'): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}
