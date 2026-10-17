import { useEffect, useState, type ReactNode } from 'react'

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div role="status" aria-live="polite">
      <div className="tk-muted">
        {label} {total ? `(${done} of ${total})` : ''}
      </div>
      <div className="tk-progress">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'warning' | 'ok'; children: ReactNode }) {
  return (
    <div className={`tk-alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000)
    return () => clearTimeout(t)
  }, [message, onDone])
  return (
    <div className="tk-toast" role="status" aria-live="polite">
      {message}
    </div>
  )
}

/** Small async-state helper used by every panel. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true, error: null }))
    fn().then(
      data => live && setState({ data, error: null, loading: false }),
      e => live && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { ...state, reload: () => setN(x => x + 1) }
}
