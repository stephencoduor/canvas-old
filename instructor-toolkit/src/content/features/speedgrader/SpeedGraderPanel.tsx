import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { PageContext } from '../../context'
import type { FeatureState } from '../../../core/features'
import { newSnippetId, renderSnippet, searchSnippets, VARIABLES, type Snippet, type SnippetContext } from '../../../core/snippets'
import { assessmentPayload, keyToAction, newDraft, reduce, total, type RubricCriterion, type RubricDraft } from '../../../core/rubric'
import { errorText } from '../../../core/bulkDates'
import { Alert, useAsync } from '../../ui/common'
import { getInstitutionSnippets, getNote, getSnippets, saveSnippets, setNote } from '../../../shared/storage'
import { useSpeedGraderLocation, type GraderLocation } from './location'
import { installKeyboardFlow } from './keyboardFlow'

interface ApiAssignment {
  id: string
  name: string
  points_possible: number | null
  anonymous_grading?: boolean
  rubric?: Array<{ id: string; description: string; points: number; ratings: Array<{ id: string; points: number; description: string }> }>
}

interface GradingContext {
  assignment: ApiAssignment
  courseName: string
  teacherName: string
  student: { firstName: string; lastName: string; fullName: string } | null
  score: number | null
  existingRubric: Record<string, { points?: number; rating_id?: string; comments?: string }> | null
}

type Tab = 'snippets' | 'rubric' | 'notes'

export function SpeedGraderPanel({ ctx, features }: { ctx: PageContext; features: FeatureState }) {
  const loc = useSpeedGraderLocation()
  const tabs = useMemo(
    () => (['snippets', 'rubric', 'notes'] as Tab[]).filter(t => (t === 'snippets' ? features.snippets : t === 'rubric' ? features.rubricHotkeys : features.privateNotes)),
    [features],
  )
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'snippets')
  const grading = useAsync(() => loadGradingContext(ctx, loc), [loc.assignmentId, loc.studentId, loc.anonymousId])

  useEffect(() => (features.keyboardFlow ? installKeyboardFlow() : undefined), [features.keyboardFlow])

  if (!loc.assignmentId) return <p className="tk-muted">Open a student's submission to use SpeedGrader Pro.</p>

  return (
    <div>
      <div className="tk-tabs" role="tablist" style={{ padding: 0, marginBottom: 12 }}>
        {tabs.map(t => (
          <button key={t} role="tab" className="tk-tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'snippets' ? 'Comments' : t === 'rubric' ? 'Rubric' : 'Notes'}
          </button>
        ))}
      </div>
      {grading.error && <Alert kind="error">Could not load this submission: {grading.error}</Alert>}
      {grading.data && tab === 'snippets' && <SnippetsTab ctx={ctx} loc={loc} grading={grading.data} onPosted={grading.reload} />}
      {grading.data && tab === 'rubric' && <RubricTab ctx={ctx} loc={loc} grading={grading.data} />}
      {tab === 'notes' && <NotesTab ctx={ctx} loc={loc} />}
    </div>
  )
}

async function loadGradingContext(ctx: PageContext, loc: GraderLocation): Promise<GradingContext> {
  const c = `/api/v1/courses/${ctx.courseId}`
  const [assignment, course, self] = await Promise.all([
    ctx.client.get<ApiAssignment>(`${c}/assignments/${loc.assignmentId}`),
    ctx.client.get<{ name: string }>(c),
    ctx.client.get<{ name: string; short_name?: string }>('/api/v1/users/self'),
  ])
  let student: GradingContext['student'] = null
  let score: number | null = null
  let existingRubric: GradingContext['existingRubric'] = null
  if (loc.studentId && !assignment.anonymous_grading) {
    const [user, sub] = await Promise.all([
      ctx.client.get<{ name: string; sortable_name?: string; short_name?: string }>(`${c}/users/${loc.studentId}`).catch(() => null),
      ctx.client.get<{ score: number | null; rubric_assessment?: GradingContext['existingRubric'] }>(`${c}/assignments/${loc.assignmentId}/submissions/${loc.studentId}?include[]=rubric_assessment`).catch(() => null),
    ])
    if (user) {
      const [last, first] = (user.sortable_name ?? '').split(',').map(s => s.trim())
      const firstName = first || user.short_name?.split(' ')[0] || user.name.split(' ')[0] || ''
      student = { firstName, lastName: last || user.name.split(' ').slice(1).join(' '), fullName: user.name }
    }
    score = sub?.score ?? null
    existingRubric = sub?.rubric_assessment ?? null
  } else if (loc.anonymousId) {
    const sub = await ctx.client
      .get<{ score: number | null; rubric_assessment?: GradingContext['existingRubric'] }>(`${c}/assignments/${loc.assignmentId}/anonymous_submissions/${loc.anonymousId}?include[]=rubric_assessment`)
      .catch(() => null)
    score = sub?.score ?? null
    existingRubric = sub?.rubric_assessment ?? null
  }
  return { assignment, courseName: course.name, teacherName: self.short_name ?? self.name, student, score, existingRubric }
}

/** Submission endpoint for the current student, anonymous or not. */
function submissionPath(ctx: PageContext, loc: GraderLocation): string | null {
  const base = `/api/v1/courses/${ctx.courseId}/assignments/${loc.assignmentId}`
  if (loc.anonymousId) return `${base}/anonymous_submissions/${loc.anonymousId}`
  if (loc.studentId) return `${base}/submissions/${loc.studentId}`
  return null
}

function SnippetsTab({ ctx, loc, grading, onPosted }: { ctx: PageContext; loc: GraderLocation; grading: GradingContext; onPosted: () => void }) {
  const own = useAsync(getSnippets, [])
  const institution = useAsync(getInstitutionSnippets, [])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Snippet | null>(null)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const all = useMemo(() => [...(own.data ?? []), ...(institution.data ?? [])], [own.data, institution.data])
  const results = searchSnippets(all, query)
  const vars: SnippetContext = {
    firstName: grading.student?.firstName,
    lastName: grading.student?.lastName,
    fullName: grading.student?.fullName,
    score: grading.score,
    pointsPossible: grading.assignment.points_possible,
    assignment: grading.assignment.name,
    course: grading.courseName,
    teacher: grading.teacherName,
  }
  const rendered = renderSnippet(text, vars)

  const pick = (s: Snippet) => {
    setPicked(s)
    setText(s.body)
    setStatus(null)
  }

  const bumpUse = async (s: Snippet) => {
    if (s.readOnly || !own.data) return
    await saveSnippets(own.data.map(x => (x.id === s.id ? { ...x, uses: (x.uses ?? 0) + 1 } : x)))
  }

  const post = async () => {
    const path = submissionPath(ctx, loc)
    if (!path) return
    try {
      await ctx.client.put(path, { comment: { text_comment: rendered.text } })
      setStatus({ kind: 'ok', text: 'Comment posted. SpeedGrader shows it after you move to another student and back, or reload.' })
      if (picked) await bumpUse(picked)
      own.reload()
      onPosted()
    } catch (e) {
      setStatus({ kind: 'error', text: `Not posted: ${errorText(e)}` })
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(rendered.text)
    setStatus({ kind: 'ok', text: 'Copied. Paste it into the comment box or a rubric comment.' })
    if (picked) await bumpUse(picked)
  }

  const saveEdit = async (s: Snippet) => {
    const list = own.data ?? []
    const exists = list.some(x => x.id === s.id)
    await saveSnippets(exists ? list.map(x => (x.id === s.id ? s : x)) : [...list, s])
    setEditing(null)
    own.reload()
  }

  const remove = async (s: Snippet) => {
    await saveSnippets((own.data ?? []).filter(x => x.id !== s.id))
    if (picked?.id === s.id) setPicked(null)
    own.reload()
  }

  if (editing) return <SnippetEditor snippet={editing} onSave={s => void saveEdit(s)} onCancel={() => setEditing(null)} />

  return (
    <div>
      <div className="tk-row">
        <input
          type="search"
          className="tk-grow"
          placeholder="Search comments, or #tag"
          aria-label="Search comments"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && results[0]) pick(results[0])
          }}
        />
        <button className="tk-btn small" onClick={() => setEditing({ id: newSnippetId(), title: '', body: '', folder: 'General', tags: [] })}>
          New
        </button>
      </div>
      <div style={{ maxHeight: '28vh', overflow: 'auto', marginBottom: 12 }} role="listbox" aria-label="Comment snippets">
        {results.map(s => (
          <div key={s.id} className="tk-row" style={{ marginBottom: 0 }}>
            <button className="tk-snippet tk-grow" role="option" aria-selected={picked?.id === s.id} onClick={() => pick(s)}>
              <strong>{s.title}</strong> <span className="tk-muted">{s.folder}</span>
              {s.readOnly && <span className="tk-badge info"> Department</span>}
              <div className="tk-muted">{s.body.slice(0, 90)}</div>
            </button>
            {!s.readOnly && (
              <>
                <button className="tk-icon" aria-label={`Edit ${s.title}`} onClick={() => setEditing(s)}>
                  ✎
                </button>
                <button className="tk-icon" aria-label={`Delete ${s.title}`} onClick={() => void remove(s)}>
                  ×
                </button>
              </>
            )}
          </div>
        ))}
        {!results.length && <p className="tk-muted">No comments match.</p>}
      </div>

      <label className="tk-muted" htmlFor="tk-comment">
        Comment (variables are filled in for {grading.student?.fullName ?? 'this student'})
      </label>
      <textarea id="tk-comment" value={text} onChange={e => setText(e.target.value)} placeholder="Pick a snippet or type a comment" />
      {text && (
        <div className="tk-card" style={{ marginTop: 8 }}>
          <div className="tk-muted">Preview</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{rendered.text}</div>
          {rendered.missing.length > 0 && (
            <Alert kind="warning">
              Not filled in: {rendered.missing.map(m => `{${m}}`).join(', ')}
              {grading.assignment.anonymous_grading ? ' (names are hidden while anonymous grading is on)' : ''}
            </Alert>
          )}
        </div>
      )}
      <div className="tk-row">
        <button className="tk-btn primary" disabled={!text.trim() || !submissionPath(ctx, loc)} onClick={() => void post()}>
          Post comment
        </button>
        <button className="tk-btn" disabled={!text.trim()} onClick={() => void copy()}>
          Copy
        </button>
      </div>
      {status && <Alert kind={status.kind}>{status.text}</Alert>}
    </div>
  )
}

function SnippetEditor({ snippet, onSave, onCancel }: { snippet: Snippet; onSave: (s: Snippet) => void; onCancel: () => void }) {
  const [s, setS] = useState(snippet)
  return (
    <div className="tk-card">
      <h3>{snippet.title ? 'Edit comment' : 'New comment'}</h3>
      <div className="tk-row">
        <input type="text" className="tk-grow" placeholder="Title" aria-label="Title" value={s.title} onChange={e => setS({ ...s, title: e.target.value })} />
        <input type="text" placeholder="Folder" aria-label="Folder" value={s.folder} onChange={e => setS({ ...s, folder: e.target.value })} />
      </div>
      <textarea aria-label="Comment text" value={s.body} onChange={e => setS({ ...s, body: e.target.value })} />
      <div className="tk-row">
        <input
          type="text"
          className="tk-grow"
          placeholder="Tags, separated by commas"
          aria-label="Tags"
          value={s.tags.join(', ')}
          onChange={e => setS({ ...s, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
        />
      </div>
      <p className="tk-muted">Variables: {VARIABLES.map(v => `{${v.name}}`).join(' ')}</p>
      <div className="tk-row">
        <button className="tk-btn primary" disabled={!s.body.trim()} onClick={() => onSave({ ...s, title: s.title.trim() || s.body.slice(0, 40) })}>
          Save
        </button>
        <button className="tk-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function RubricTab({ ctx, loc, grading }: { ctx: PageContext; loc: GraderLocation; grading: GradingContext }) {
  const criteria: RubricCriterion[] = useMemo(() => grading.assignment.rubric ?? [], [grading.assignment.rubric])
  const initial = useMemo(() => {
    const existing: Record<string, { points?: number; ratingId?: string; comments?: string }> = {}
    for (const [id, v] of Object.entries(grading.existingRubric ?? {})) existing[id] = { points: v.points, ratingId: v.rating_id, comments: v.comments }
    return newDraft(criteria, existing)
  }, [criteria, grading.existingRubric])
  const [draft, dispatch] = useReducer(reduce, initial)
  const [hotkeys, setHotkeys] = useState(true)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const save = useCallback(async () => {
    const path = submissionPath(ctx, loc)
    if (!path) return
    try {
      await ctx.client.put(path, assessmentPayload(draft))
      dispatch({ type: 'saved' })
      setStatus({ kind: 'ok', text: `Rubric saved (${total(draft)} points). SpeedGrader shows it after you reload or change student.` })
    } catch (e) {
      setStatus({ kind: 'error', text: `Not saved: ${errorText(e)}` })
    }
  }, [ctx, loc, draft])

  useEffect(() => {
    if (!hotkeys) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
        return
      }
      const action = keyToAction(e)
      if (action) {
        e.preventDefault()
        e.stopPropagation()
        dispatch(action)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hotkeys, save])

  if (!criteria.length) return <p className="tk-muted">This assignment has no rubric.</p>

  return (
    <div>
      <div className="tk-row">
        <label>
          <input type="checkbox" checked={hotkeys} onChange={() => setHotkeys(v => !v)} />
          Hotkeys
        </label>
        <span className="tk-muted">
          <kbd>1</kbd>-<kbd>9</kbd> rating, <kbd>↑</kbd>/<kbd>↓</kbd> criterion, <kbd>Alt</kbd>+<kbd>F</kbd> full marks, <kbd>Alt</kbd>+<kbd>H</kbd> half, <kbd>Alt</kbd>+<kbd>S</kbd> save
        </span>
      </div>
      {draft.criteria.map((c, i) => (
        <CriterionView key={c.id} c={c} draft={draft} index={i} onFocus={() => dispatch({ type: 'focus', index: i })} onRate={n => {
            dispatch({ type: 'focus', index: i })
            dispatch({ type: 'rate', n })
          }} />
      ))}
      <div className="tk-row">
        <strong className="tk-grow">
          Total {total(draft)} / {criteria.reduce((s, c) => s + c.points, 0)}
        </strong>
        <button className="tk-btn primary" disabled={!draft.dirty} onClick={() => void save()}>
          Save rubric
        </button>
      </div>
      {status && <Alert kind={status.kind}>{status.text}</Alert>}
    </div>
  )
}

function CriterionView({ c, draft, index, onFocus, onRate }: { c: RubricCriterion; draft: RubricDraft; index: number; onFocus: () => void; onRate: (n: number) => void }) {
  const score = draft.scores[c.id]!
  return (
    <div className={`tk-criterion ${draft.focus === index ? 'focused' : ''}`} onClick={onFocus}>
      <div className="tk-row" style={{ marginBottom: 4 }}>
        <strong className="tk-grow">{c.description}</strong>
        <span>
          {score.points ?? '–'} / {c.points}
        </span>
      </div>
      {c.ratings.map((r, n) => (
        <button
          key={r.id}
          className={`tk-rating ${score.ratingId === r.id ? 'selected' : ''}`}
          onClick={e => {
            e.stopPropagation()
            onRate(n + 1)
          }}
        >
          <kbd>{n + 1}</kbd> {r.description} ({r.points})
        </button>
      ))}
    </div>
  )
}

function NotesTab({ ctx, loc }: { ctx: PageContext; loc: GraderLocation }) {
  const who = loc.studentId ?? (loc.anonymousId ? `anon-${loc.anonymousId}` : null)
  const note = useAsync(() => (who ? getNote(ctx.host, ctx.courseId, who) : Promise.resolve('')), [who])
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(true)
  useEffect(() => {
    if (note.data !== null) {
      setText(note.data)
      setSaved(true)
    }
  }, [note.data])
  useEffect(() => {
    if (saved || !who) return
    const t = setTimeout(() => void setNote(ctx.host, ctx.courseId, who, text).then(() => setSaved(true)), 600)
    return () => clearTimeout(t)
  }, [text, saved, who, ctx])

  if (!who) return <p className="tk-muted">Select a student first.</p>
  return (
    <div>
      <p className="tk-muted">Private to you and stored only in this browser. Notes follow the student across every assignment in this course.</p>
      <textarea
        aria-label="Private note"
        value={text}
        onChange={e => {
          setText(e.target.value)
          setSaved(false)
        }}
        style={{ minHeight: 180 }}
      />
      <div className="tk-muted">{saved ? 'Saved' : 'Saving…'}</div>
    </div>
  )
}

function isTyping(e: KeyboardEvent): boolean {
  const path = e.composedPath()
  return path.some(el => {
    if (!(el instanceof HTMLElement)) return false
    return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
  })
}
