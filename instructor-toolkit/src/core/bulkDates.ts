// Plans and applies bulk date changes. Planning is pure (it only computes the
// before and after values, so the UI can preview every change); applying
// groups changes by write path and sends as few requests as Canvas allows.

import type { CanvasClient, Progress } from './canvasClient'
import type { DatedItem, DateField, DateValues, OverrideDates } from './courseModel'
import { setLocalDate, shiftDate, type ShiftRule } from './dates'

export interface OverrideChange {
  id: string
  title: string
  before: DateValues
  after: DateValues
}

export interface DateChange {
  item: DatedItem
  before: DateValues
  after: DateValues
  overrides: OverrideChange[]
}

export type DateOperation =
  | { op: 'shift'; rule: ShiftRule }
  | { op: 'set'; ymd: string }
  | { op: 'clear' }
  | { op: 'restore'; snapshot: DateSnapshot }

export interface PlanOptions {
  fields: DateField[]
  /** Also change section, group and student override dates. */
  includeOverrides: boolean
  timeZone: string
}

/** Previous dates of one item, as stored in the undo journal. */
export interface DateSnapshot {
  base: DateValues
  overrides: Pick<OverrideDates, 'id' | 'due_at' | 'unlock_at' | 'lock_at'>[]
}

export function snapshotOf(item: DatedItem): DateSnapshot {
  return {
    base: { ...item.base },
    overrides: item.overrides.map(o => ({ id: o.id, due_at: o.due_at, unlock_at: o.unlock_at, lock_at: o.lock_at })),
  }
}

function applyOp(values: DateValues, op: DateOperation, opts: PlanOptions, fields: DateField[], restoreFrom?: DateValues): DateValues {
  const out = { ...values }
  for (const f of fields) {
    if (!opts.fields.includes(f) && op.op !== 'restore') continue
    switch (op.op) {
      case 'shift':
        out[f] = shiftDate(values[f], op.rule, opts.timeZone)
        break
      case 'set':
        // Absolute dates only apply to dates that exist, except due dates, which can be added.
        if (values[f] || f === 'due_at') out[f] = setLocalDate(values[f], op.ymd, opts.timeZone)
        break
      case 'clear':
        out[f] = null
        break
      case 'restore':
        if (restoreFrom) out[f] = restoreFrom[f]
        break
    }
  }
  return out
}

const same = (a: DateValues, b: DateValues) => a.due_at === b.due_at && a.unlock_at === b.unlock_at && a.lock_at === b.lock_at

export function planDateChanges(items: DatedItem[], op: DateOperation, opts: PlanOptions): DateChange[] {
  const changes: DateChange[] = []
  for (const item of items) {
    if (item.write.kind === 'none') continue
    const snapshotBase = op.op === 'restore' ? op.snapshot.base : undefined
    const after = applyOp(item.base, op, opts, item.fields, snapshotBase)
    const overrides: OverrideChange[] = []
    if ((opts.includeOverrides || op.op === 'restore') && item.overridesKnown) {
      for (const o of item.overrides) {
        const prev = op.op === 'restore' ? op.snapshot.overrides.find(s => s.id === o.id) : undefined
        if (op.op === 'restore' && !prev) continue
        const before: DateValues = { due_at: o.due_at, unlock_at: o.unlock_at, lock_at: o.lock_at }
        const oAfter = applyOp(before, op, opts, item.fields, prev)
        if (!same(before, oAfter)) overrides.push({ id: o.id, title: o.title, before, after: oAfter })
      }
    }
    if (!same(item.base, after) || overrides.length) {
      changes.push({ item, before: { ...item.base }, after, overrides })
    }
  }
  return changes
}

/** Problems Canvas would reject, found before anything is sent. */
export function validateChanges(changes: DateChange[]): { change: DateChange; problem: string }[] {
  const problems: { change: DateChange; problem: string }[] = []
  const check = (change: DateChange, v: DateValues, who: string) => {
    const t = (s: string | null) => (s ? Date.parse(s) : null)
    const due = t(v.due_at)
    const unlock = t(v.unlock_at)
    const lock = t(v.lock_at)
    if (unlock !== null && due !== null && unlock > due) problems.push({ change, problem: `${who}: available-from date is after the due date` })
    if (lock !== null && due !== null && lock < due) problems.push({ change, problem: `${who}: until date is before the due date` })
    if (unlock !== null && lock !== null && unlock > lock) problems.push({ change, problem: `${who}: available-from date is after the until date` })
  }
  for (const c of changes) {
    check(c, c.after, 'Everyone')
    for (const o of c.overrides) check(c, o.after, o.title)
  }
  return problems
}

export interface ApplyResult {
  applied: DateChange[]
  failed: { change: DateChange; error: string }[]
}

export type ProgressReporter = (done: number, total: number, label: string) => void

const BULK_BATCH = 50

export async function applyDateChanges(
  client: CanvasClient,
  courseId: string,
  changes: DateChange[],
  report: ProgressReporter = () => {},
): Promise<ApplyResult> {
  const c = `/api/v1/courses/${courseId}`
  const result: ApplyResult = { applied: [], failed: [] }
  const total = changes.length
  let done = 0

  const assignmentChanges = changes.filter(ch => ch.item.write.kind === 'assignment')
  for (let i = 0; i < assignmentChanges.length; i += BULK_BATCH) {
    const batch = assignmentChanges.slice(i, i + BULK_BATCH)
    const payload = batch.map(ch => ({
      id: (ch.item.write as { assignmentId: string }).assignmentId,
      all_dates: [{ base: true, ...ch.after }, ...ch.overrides.map(o => ({ id: o.id, ...o.after }))],
    }))
    try {
      const progress = await client.put<Progress>(`${c}/assignments/bulk_update`, payload)
      const final = await client.waitForProgress(progress, p =>
        report(done + Math.round(((p.completion ?? 0) / 100) * batch.length), total, 'Updating assignments'),
      )
      const errors = bulkErrors(final)
      for (const ch of batch) {
        const err = errors.get((ch.item.write as { assignmentId: string }).assignmentId)
        if (err) result.failed.push({ change: ch, error: err })
        else result.applied.push(ch)
      }
    } catch (e) {
      for (const ch of batch) result.failed.push({ change: ch, error: errorText(e) })
    }
    done += batch.length
    report(done, total, 'Updating assignments')
  }

  for (const ch of changes) {
    const w = ch.item.write
    if (w.kind === 'assignment' || w.kind === 'none') continue
    try {
      if (w.kind === 'module') {
        await client.put(`${c}/modules/${w.moduleId}`, { module: { unlock_at: ch.after.unlock_at } })
      } else {
        const path = w.kind === 'quiz' ? `${c}/quizzes/${w.quizId}/date_details` : `${c}/discussion_topics/${w.topicId}/date_details`
        const body: Record<string, unknown> = {}
        for (const f of ch.item.fields) body[f] = ch.after[f]
        // The Learning Object Dates API replaces the override list when one is sent,
        // so send every known override, changed or not.
        if (ch.overrides.length) {
          body.assignment_overrides = ch.item.overrides.map(o => {
            const changed = ch.overrides.find(x => x.id === o.id)
            const v = changed ? changed.after : o
            return { id: o.id, due_at: v.due_at, unlock_at: v.unlock_at, lock_at: v.lock_at }
          })
        }
        await client.put(path, body)
      }
      result.applied.push(ch)
    } catch (e) {
      result.failed.push({ change: ch, error: errorText(e) })
    }
    done += 1
    report(done, total, 'Updating quizzes, discussions and modules')
  }
  return result
}

/** bulk_update reports per-assignment failures in the Progress results. */
function bulkErrors(progress: Progress & { results?: unknown }): Map<string, string> {
  const map = new Map<string, string>()
  const results = progress.results
  if (Array.isArray(results)) {
    for (const r of results as Array<{ assignment_id?: string | number; errors?: unknown }>) {
      if (r?.assignment_id !== undefined && r.errors) map.set(String(r.assignment_id), JSON.stringify(r.errors))
    }
  }
  return map
}

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'body' in e) {
    const body = (e as { body: unknown }).body
    if (body && typeof body === 'object') {
      const errors = (body as { errors?: unknown }).errors
      if (errors) return typeof errors === 'string' ? errors : JSON.stringify(errors)
    }
  }
  return e instanceof Error ? e.message : String(e)
}

/** Applies the new values to the in-memory items after a successful write. */
export function commitToItems(changes: DateChange[]): void {
  for (const ch of changes) {
    ch.item.base = { ...ch.after }
    for (const o of ch.overrides) {
      const target = ch.item.overrides.find(x => x.id === o.id)
      if (target) Object.assign(target, o.after)
    }
  }
}
