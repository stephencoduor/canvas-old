import { useState } from 'react'
import type { PageContext } from '../../context'
import { applyFixes, findingsToCsv, isFixable, runAudit, type AuditReport, type Category, type Finding, type Severity } from '../../../core/audit/auditor'
import { Alert, ProgressBar } from '../../ui/common'

const CATEGORY_LABEL: Record<Category, string> = {
  'old-course-link': 'Links to another course',
  'missing-file': 'Missing files',
  'unpublished-file': 'Unpublished or hidden files',
  'missing-page': 'Missing pages',
  'third-party-tool': 'Google, Microsoft and other tools',
  'stale-date': "Last term's dates",
  'unpublished-in-module': 'Unpublished items in modules',
  'native-validator': "Canvas's link validator",
}

export function AuditPanel({ ctx }: { ctx: PageContext }) {
  const [useNative, setUseNative] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [fixing, setFixing] = useState<{ done: number; total: number } | null>(null)
  const [fixResult, setFixResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const run = async () => {
    setError(null)
    setReport(null)
    setFixResult(null)
    try {
      const r = await runAudit(ctx.client, ctx.courseId, { canvasOrigin: ctx.origin, useNativeValidator: useNative, resolveFixes: true }, setStatus)
      setReport(r)
      setChosen(new Set(r.findings.filter(f => f.fix && isFixable(f.location.type)).map(f => f.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatus(null)
    }
  }

  const fix = async () => {
    if (!report) return
    const selected = report.findings.filter(f => chosen.has(f.id))
    setFixing({ done: 0, total: selected.length })
    const res = await applyFixes(ctx.client, ctx.courseId, selected, (done, total) => setFixing({ done, total }))
    setFixing(null)
    const fixedIds = new Set(res.fixed.map(f => f.id))
    setReport({ ...report, findings: report.findings.filter(f => !fixedIds.has(f.id)) })
    setChosen(new Set())
    setFixResult(
      res.failed.length
        ? { kind: 'error', text: `Fixed ${res.fixed.length} link(s); ${res.failed.length} could not be fixed: ${res.failed.map(f => `${f.finding.location.title} (${f.error})`).join('; ')}` }
        : { kind: 'ok', text: `Fixed ${res.fixed.length} link(s). Run the audit again to confirm.` },
    )
  }

  const download = () => {
    if (!report) return
    const blob = new Blob([findingsToCsv(report)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `course-${report.courseId}-audit.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const counts = (s: Severity) => report?.findings.filter(f => f.severity === s).length ?? 0
  const shown = report?.findings.filter(f => category === 'all' || f.category === category) ?? []
  const fixableChosen = report?.findings.filter(f => chosen.has(f.id)).length ?? 0

  return (
    <div>
      <p className="tk-muted">
        Run this on a course after copying content into it. It checks pages, assignments, discussions, announcements, the syllabus, quizzes and modules for links
        that still point at the old course, missing or unpublished files, Google and Microsoft items that need re-linking, and dates from last term.
      </p>
      <div className="tk-row">
        <label>
          <input type="checkbox" checked={useNative} onChange={() => setUseNative(v => !v)} />
          Also run Canvas's link validator (slower, checks external links)
        </label>
      </div>
      <div className="tk-row">
        <button className="tk-btn primary" disabled={!!status} onClick={() => void run()}>
          {report ? 'Run again' : 'Run audit'}
        </button>
        {report && (
          <button className="tk-btn" onClick={download}>
            Download CSV
          </button>
        )}
      </div>
      {status && <ProgressBar done={0} total={0} label={status} />}
      {error && <Alert kind="error">The audit stopped: {error}</Alert>}

      {report && (
        <>
          <div className="tk-row">
            <span className="tk-badge error">{counts('error')} to fix</span>
            <span className="tk-badge warning">{counts('warning')} to check</span>
            <span className="tk-badge info">{counts('info')} for information</span>
            <span className="tk-muted">{report.scannedItems} items scanned in {report.courseName}</span>
          </div>
          {report.notes.map((n, i) => (
            <Alert key={i} kind="warning">
              {n}
            </Alert>
          ))}
          {fixResult && <Alert kind={fixResult.kind}>{fixResult.text}</Alert>}
          {report.findings.length === 0 ? (
            <Alert kind="ok">No problems found.</Alert>
          ) : (
            <>
              <div className="tk-row">
                <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value as Category | 'all')}>
                  <option value="all">All findings</option>
                  {(Object.keys(CATEGORY_LABEL) as Category[])
                    .filter(c => report.findings.some(f => f.category === c))
                    .map(c => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]} ({report.findings.filter(f => f.category === c).length})
                      </option>
                    ))}
                </select>
                <button className="tk-btn" disabled={!fixableChosen || !!fixing} onClick={() => void fix()}>
                  Fix {fixableChosen} selected link(s)
                </button>
              </div>
              {fixing && <ProgressBar done={fixing.done} total={fixing.total} label="Rewriting links" />}
              <ul className="tk-list">
                {shown.map(f => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    chosen={chosen.has(f.id)}
                    onToggle={() =>
                      setChosen(s => {
                        const n = new Set(s)
                        if (n.has(f.id)) n.delete(f.id)
                        else n.add(f.id)
                        return n
                      })
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

function FindingRow({ finding: f, chosen, onToggle }: { finding: Finding; chosen: boolean; onToggle: () => void }) {
  const canFix = !!f.fix && isFixable(f.location.type)
  return (
    <li>
      <div className="tk-row" style={{ marginBottom: 4 }}>
        <span className={`tk-badge ${f.severity}`}>{f.severity === 'error' ? 'Fix' : f.severity === 'warning' ? 'Check' : 'Info'}</span>
        <strong className="tk-grow">
          {f.location.htmlUrl ? (
            <a href={f.location.htmlUrl} target="_blank" rel="noreferrer">
              {f.location.title}
            </a>
          ) : (
            f.location.title
          )}
        </strong>
        <span className="tk-muted">{CATEGORY_LABEL[f.category]}</span>
      </div>
      <div>{f.detail}</div>
      {f.fix && (
        <div className="tk-row" style={{ marginTop: 4 }}>
          {canFix ? (
            <label>
              <input type="checkbox" checked={chosen} onChange={onToggle} />
              {f.fix.label}
            </label>
          ) : (
            <span className="tk-muted">Suggested: {f.fix.label} (edit this one by hand)</span>
          )}
        </div>
      )}
    </li>
  )
}
