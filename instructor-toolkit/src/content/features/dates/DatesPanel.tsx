import { useMemo, useState } from 'react'
import type { PageContext } from '../../context'
import { loadCourseTable, type CourseTable, type DateField, type DatedItem, type ItemKind } from '../../../core/courseModel'
import {
  applyDateChanges,
  commitToItems,
  planDateChanges,
  snapshotOf,
  validateChanges,
  type ApplyResult,
  type DateChange,
  type DateOperation,
} from '../../../core/bulkDates'
import { formatLocal, type WeekendPolicy } from '../../../core/dates'
import { applySis, planSis, type SisPlan } from '../../../core/sis'
import { Alert, ProgressBar, useAsync } from '../../ui/common'
import { getSisRules, getUndo, pushUndo, removeUndo, setSisRules, type UndoEntry } from '../../../shared/storage'

const KIND_LABEL: Record<ItemKind, string> = {
  Assignment: 'Assignment',
  Quiz: 'Quiz',
  NewQuiz: 'New Quiz',
  Discussion: 'Discussion',
  Page: 'Page',
  Module: 'Module',
}
const FIELD_LABEL: Record<DateField, string> = { due_at: 'Due', unlock_at: 'Available from', lock_at: 'Until' }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type OpKind = 'shift' | 'set' | 'clear'

export function DatesPanel({ ctx, sisEnabled }: { ctx: PageContext; sisEnabled: boolean }) {
  const table = useAsync(() => loadCourseTable(ctx.client, ctx.courseId), [ctx.courseId])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moduleFilter, setModuleFilter] = useState('all')
  const [kinds, setKinds] = useState<Set<ItemKind>>(new Set(['Assignment', 'Quiz', 'NewQuiz', 'Discussion', 'Module']))
  const [search, setSearch] = useState('')

  if (table.loading) return <ProgressBar done={0} total={0} label="Loading modules, assignments, quizzes and discussions" />
  if (table.error || !table.data) return <Alert kind="error">Could not load this course: {table.error}</Alert>

  const data = table.data
  const visible = data.items.filter(
    it =>
      kinds.has(it.kind) &&
      (moduleFilter === 'all' || (moduleFilter === 'none' ? !it.moduleId : it.moduleId === moduleFilter)) &&
      (!search || it.title.toLowerCase().includes(search.toLowerCase())),
  )
  const selectedItems = data.items.filter(it => selected.has(it.key))
  const toggle = (key: string) =>
    setSelected(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const allVisibleSelected = visible.length > 0 && visible.every(it => selected.has(it.key))

  return (
    <div>
      <div className="tk-row">
        <select aria-label="Module" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
          <option value="all">All modules</option>
          {data.modules.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="none">Not in a module</option>
        </select>
        <input type="search" placeholder="Search items" aria-label="Search items" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="tk-btn small" onClick={table.reload}>
          Reload
        </button>
      </div>
      <div className="tk-row" role="group" aria-label="Item types">
        {(Object.keys(KIND_LABEL) as ItemKind[])
          .filter(k => k !== 'Page')
          .map(k => (
            <label key={k}>
              <input
                type="checkbox"
                checked={kinds.has(k)}
                onChange={() =>
                  setKinds(s => {
                    const n = new Set(s)
                    if (n.has(k)) n.delete(k)
                    else n.add(k)
                    return n
                  })
                }
              />
              {KIND_LABEL[k]}
            </label>
          ))}
      </div>

      <div style={{ maxHeight: '38vh', overflow: 'auto', border: '1px solid var(--tk-border)', borderRadius: 8, marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allVisibleSelected}
                  onChange={() =>
                    setSelected(s => {
                      const n = new Set(s)
                      for (const it of visible) allVisibleSelected ? n.delete(it.key) : n.add(it.key)
                      return n
                    })
                  }
                />
              </th>
              <th>Item</th>
              <th>Due</th>
              <th>Available from</th>
              <th>Until</th>
              {sisEnabled && <th>SIS</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((it, i) => {
              const header = it.moduleName !== (visible[i - 1]?.moduleName ?? undefined) || i === 0
              return [
                header && (
                  <tr className="module-row" key={`h-${it.key}`}>
                    <td colSpan={sisEnabled ? 6 : 5}>{it.moduleName ?? 'Not in a module'}</td>
                  </tr>
                ),
                <tr key={it.key}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${it.title}`} checked={selected.has(it.key)} onChange={() => toggle(it.key)} />
                  </td>
                  <td>
                    {it.htmlUrl ? (
                      <a href={it.htmlUrl} target="_blank" rel="noreferrer">
                        {it.title}
                      </a>
                    ) : (
                      it.title
                    )}{' '}
                    <span className="tk-badge">{KIND_LABEL[it.kind]}</span> {!it.published && <span className="tk-badge warning">Unpublished</span>}
                    {it.overrides.length > 0 && <span className="tk-badge info">{it.overrides.length} override(s)</span>}
                    {!it.overridesKnown && <span className="tk-badge warning">Overrides not loaded</span>}
                  </td>
                  {(['due_at', 'unlock_at', 'lock_at'] as DateField[]).map(f => (
                    <td key={f}>{it.fields.includes(f) ? formatLocal(it.base[f], ctx.timeZone) : ''}</td>
                  ))}
                  {sisEnabled && <td>{it.assignmentId ? (it.postToSis ? <span className="tk-badge ok">On</span> : <span className="tk-badge">Off</span>) : ''}</td>}
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>
      <div className="tk-muted" style={{ marginBottom: 12 }}>
        {selectedItems.length} selected of {data.items.length}. Times shown in {ctx.timeZone}.
      </div>

      <DateActions ctx={ctx} table={data} items={selectedItems} onApplied={() => setSelected(new Set())} />
      {sisEnabled && <SisActions ctx={ctx} items={selectedItems} />}
      <UndoList ctx={ctx} table={data} onRestored={table.reload} />
    </div>
  )
}

function DateActions({ ctx, table, items, onApplied }: { ctx: PageContext; table: CourseTable; items: DatedItem[]; onApplied: () => void }) {
  const [op, setOp] = useState<OpKind>('shift')
  const [days, setDays] = useState(7)
  const [weekend, setWeekend] = useState<WeekendPolicy>('keep')
  const [time, setTime] = useState('')
  const [weekdayMap, setWeekdayMap] = useState<Record<number, number>>({})
  const [ymd, setYmd] = useState('')
  const [fields, setFields] = useState<Set<DateField>>(new Set(['due_at', 'unlock_at', 'lock_at']))
  const [includeOverrides, setIncludeOverrides] = useState(true)
  const [preview, setPreview] = useState<DateChange[] | null>(null)
  const [running, setRunning] = useState<{ done: number; total: number; label: string } | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const operation: DateOperation | null = useMemo(() => {
    if (op === 'shift') return { op: 'shift', rule: { days, weekendPolicy: weekend, setTime: time || undefined, weekdayMap: Object.keys(weekdayMap).length ? weekdayMap : undefined } }
    if (op === 'set') return ymd ? { op: 'set', ymd } : null
    return { op: 'clear' }
  }, [op, days, weekend, time, weekdayMap, ymd])

  const makePreview = () => {
    if (!operation) return
    setResult(null)
    setPreview(planDateChanges(items, operation, { fields: [...fields], includeOverrides, timeZone: ctx.timeZone }))
  }

  const apply = async () => {
    if (!preview?.length) return
    const entry: UndoEntry = {
      id: `u${Date.now()}`,
      courseId: ctx.courseId,
      createdAt: new Date().toISOString(),
      label: describe(operation!, preview.length),
      snapshots: Object.fromEntries(preview.map(ch => [ch.item.key, snapshotOf(ch.item)])),
    }
    await pushUndo(ctx.host, entry)
    setRunning({ done: 0, total: preview.length, label: 'Starting' })
    const res = await applyDateChanges(ctx.client, table.courseId, preview, (done, total, label) => setRunning({ done, total, label }))
    commitToItems(res.applied)
    setRunning(null)
    setPreview(null)
    setResult(res)
    onApplied()
  }

  const problems = preview ? validateChanges(preview) : []

  return (
    <div className="tk-card">
      <h3>Change dates</h3>
      <div className="tk-row" role="radiogroup" aria-label="Operation">
        {(['shift', 'set', 'clear'] as OpKind[]).map(k => (
          <label key={k}>
            <input type="radio" name="tk-op" checked={op === k} onChange={() => setOp(k)} />
            {k === 'shift' ? 'Shift' : k === 'set' ? 'Set a date' : 'Clear'}
          </label>
        ))}
      </div>
      {op === 'shift' && (
        <>
          <div className="tk-row">
            <label>
              Move by
              <input type="number" value={days} onChange={e => setDays(Number(e.target.value) || 0)} aria-label="Days to move" />
              days
            </label>
            <span className="tk-muted">(negative moves earlier)</span>
          </div>
          <div className="tk-row">
            <label>
              Weekends
              <select value={weekend} onChange={e => setWeekend(e.target.value as WeekendPolicy)}>
                <option value="keep">Allow weekend dates</option>
                <option value="next-weekday">Move to Monday</option>
                <option value="previous-weekday">Move to Friday</option>
              </select>
            </label>
            <label>
              Set time
              <input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </label>
          </div>
          <details className="tk-row">
            <summary>Change the weekly pattern (for example Tue/Thu to Mon/Wed)</summary>
            <div className="tk-row" style={{ marginTop: 8 }}>
              {WEEKDAYS.map((name, from) => (
                <label key={name}>
                  {name}→
                  <select
                    value={weekdayMap[from] ?? from}
                    onChange={e => {
                      const to = Number(e.target.value)
                      setWeekdayMap(m => {
                        const n = { ...m }
                        if (to === from) delete n[from]
                        else n[from] = to
                        return n
                      })
                    }}
                  >
                    {WEEKDAYS.map((n2, to) => (
                      <option key={n2} value={to}>
                        {n2}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
        </>
      )}
      {op === 'set' && (
        <div className="tk-row">
          <label>
            New date
            <input type="date" value={ymd} onChange={e => setYmd(e.target.value)} />
          </label>
          <span className="tk-muted">Keeps each item's time of day.</span>
        </div>
      )}
      <div className="tk-row" role="group" aria-label="Dates to change">
        {(['due_at', 'unlock_at', 'lock_at'] as DateField[]).map(f => (
          <label key={f}>
            <input
              type="checkbox"
              checked={fields.has(f)}
              onChange={() =>
                setFields(s => {
                  const n = new Set(s)
                  if (n.has(f)) n.delete(f)
                  else n.add(f)
                  return n
                })
              }
            />
            {FIELD_LABEL[f]}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={includeOverrides} onChange={() => setIncludeOverrides(v => !v)} />
          Section and student dates too
        </label>
      </div>
      <div className="tk-row">
        <button className="tk-btn" disabled={!items.length || !operation || !fields.size} onClick={makePreview}>
          Preview {items.length ? `${items.length} item(s)` : ''}
        </button>
        {!items.length && <span className="tk-muted">Select items in the table first.</span>}
      </div>

      {preview && <ChangePreview changes={preview} timeZone={ctx.timeZone} />}
      {preview && problems.length > 0 && (
        <Alert kind="warning">
          Canvas may reject {problems.length} change(s):
          <ul>
            {problems.slice(0, 8).map((p, i) => (
              <li key={i}>
                {p.change.item.title}: {p.problem}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {preview && preview.length > 0 && !running && (
        <div className="tk-row">
          <button className="tk-btn primary" onClick={() => void apply()}>
            Apply {preview.length} change(s)
          </button>
          <button className="tk-btn" onClick={() => setPreview(null)}>
            Cancel
          </button>
          <span className="tk-muted">The current dates are saved first so you can undo.</span>
        </div>
      )}
      {preview && preview.length === 0 && <Alert kind="warning">Nothing would change. Check which dates are ticked.</Alert>}
      {running && <ProgressBar {...running} />}
      {result && <ResultSummary result={result} />}
    </div>
  )
}

function ChangePreview({ changes, timeZone }: { changes: DateChange[]; timeZone: string }) {
  return (
    <div style={{ maxHeight: '30vh', overflow: 'auto', marginBottom: 10 }}>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Due</th>
            <th>Available from</th>
            <th>Until</th>
          </tr>
        </thead>
        <tbody>
          {changes.flatMap(ch => [
            <tr key={ch.item.key}>
              <td>{ch.item.title}</td>
              {(['due_at', 'unlock_at', 'lock_at'] as DateField[]).map(f => (
                <td key={f}>
                  <DiffCell before={ch.before[f]} after={ch.after[f]} tz={timeZone} />
                </td>
              ))}
            </tr>,
            ...ch.overrides.map(o => (
              <tr key={`${ch.item.key}-${o.id}`}>
                <td className="tk-muted">↳ {o.title}</td>
                {(['due_at', 'unlock_at', 'lock_at'] as DateField[]).map(f => (
                  <td key={f}>
                    <DiffCell before={o.before[f]} after={o.after[f]} tz={timeZone} />
                  </td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  )
}

function DiffCell({ before, after, tz }: { before: string | null; after: string | null; tz: string }) {
  if (before === after) return <span>{formatLocal(before, tz)}</span>
  return (
    <span>
      <span className="was">{formatLocal(before, tz)}</span>
      <br />
      <span className="changed">{formatLocal(after, tz)}</span>
    </span>
  )
}

function ResultSummary({ result }: { result: ApplyResult }) {
  return (
    <>
      {result.applied.length > 0 && <Alert kind="ok">Updated {result.applied.length} item(s).</Alert>}
      {result.failed.length > 0 && (
        <Alert kind="error">
          {result.failed.length} item(s) were not changed:
          <ul>
            {result.failed.map(f => (
              <li key={f.change.item.key}>
                {f.change.item.title}: {f.error}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  )
}

function describe(op: DateOperation, n: number): string {
  if (op.op === 'shift') return `Shifted ${n} item(s) by ${op.rule.days} day(s)`
  if (op.op === 'set') return `Set ${n} item(s) to ${op.ymd}`
  if (op.op === 'clear') return `Cleared dates on ${n} item(s)`
  return `Restored ${n} item(s)`
}

function UndoList({ ctx, table, onRestored }: { ctx: PageContext; table: CourseTable; onRestored: () => void }) {
  const undo = useAsync(() => getUndo(ctx.host, ctx.courseId), [ctx.courseId])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  if (!undo.data?.length) return null

  const restore = async (entry: UndoEntry) => {
    setBusy(entry.id)
    const changes: DateChange[] = []
    for (const item of table.items) {
      const snap = entry.snapshots[item.key]
      if (!snap) continue
      changes.push(...planDateChanges([item], { op: 'restore', snapshot: snap }, { fields: ['due_at', 'unlock_at', 'lock_at'], includeOverrides: true, timeZone: ctx.timeZone }))
    }
    const res = await applyDateChanges(ctx.client, ctx.courseId, changes)
    setBusy(null)
    if (res.failed.length) setMessage({ kind: 'error', text: `${res.failed.length} item(s) could not be restored: ${res.failed.map(f => f.change.item.title).join(', ')}` })
    else {
      setMessage({ kind: 'ok', text: `Restored ${res.applied.length} item(s).` })
      await removeUndo(ctx.host, ctx.courseId, entry.id)
    }
    undo.reload()
    onRestored()
  }

  return (
    <div className="tk-card">
      <h3>Undo</h3>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <ul className="tk-list">
        {undo.data.map(e => (
          <li key={e.id} className="tk-row">
            <span className="tk-grow">
              {e.label} <span className="tk-muted">{new Date(e.createdAt).toLocaleString()}</span>
            </span>
            <button className="tk-btn small" disabled={busy !== null} onClick={() => void restore(e)}>
              {busy === e.id ? 'Restoring…' : 'Restore these dates'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SisActions({ ctx, items }: { ctx: PageContext; items: DatedItem[] }) {
  const rules = useAsync(getSisRules, [])
  const [plan, setPlan] = useState<{ enable: boolean; plan: SisPlan } | null>(null)
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  if (!rules.data) return null
  const r = rules.data
  const graded = items.filter(i => i.assignmentId)

  const start = (enable: boolean) => {
    setMessage(null)
    setPlan({ enable, plan: planSis(graded, enable, r) })
  }
  const apply = async () => {
    if (!plan) return
    setRunning({ done: 0, total: plan.plan.change.length })
    const res = await applySis(ctx.client, ctx.courseId, plan.plan.change, plan.enable, (done, total) => setRunning({ done, total }))
    setRunning(null)
    setPlan(null)
    setMessage(
      res.failed.length
        ? { kind: 'error', text: `${res.applied.length} changed, ${res.failed.length} failed: ${res.failed.map(f => `${f.item.title} (${f.error})`).join('; ')}` }
        : { kind: 'ok', text: `Sync to SIS turned ${plan.enable ? 'on' : 'off'} for ${res.applied.length} assignment(s).` },
    )
  }

  return (
    <div className="tk-card">
      <h3>Sync to SIS</h3>
      <div className="tk-row">
        <label>
          <input type="checkbox" checked={r.requireDueDate} onChange={() => void setSisRules({ ...r, requireDueDate: !r.requireDueDate }).then(rules.reload)} />
          My SIS requires a due date
        </label>
        <label>
          Name limit
          <input type="number" value={r.maxNameLength} min={1} onChange={e => void setSisRules({ ...r, maxNameLength: Number(e.target.value) || 255 }).then(rules.reload)} />
        </label>
      </div>
      <div className="tk-row">
        <button className="tk-btn" disabled={!graded.length} onClick={() => start(true)}>
          Turn on for {graded.length} graded item(s)
        </button>
        <button className="tk-btn" disabled={!graded.length} onClick={() => start(false)}>
          Turn off
        </button>
      </div>
      {plan && (
        <>
          <p>
            {plan.plan.change.length} will change, {plan.plan.unchanged.length} already {plan.enable ? 'on' : 'off'}
            {plan.plan.blocked.length ? `, ${plan.plan.blocked.length} blocked` : ''}.
          </p>
          {plan.plan.blocked.length > 0 && (
            <Alert kind="warning">
              <ul>
                {plan.plan.blocked.map(b => (
                  <li key={b.item.key}>
                    {b.item.title}: {b.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="tk-row">
            <button className="tk-btn primary" disabled={!plan.plan.change.length || !!running} onClick={() => void apply()}>
              Apply
            </button>
            <button className="tk-btn" onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {running && <ProgressBar done={running.done} total={running.total} label="Updating Sync to SIS" />}
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </div>
  )
}
