// Options page: feature switches, extra Canvas domains, snippet import/export.

import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { FEATURES, normalizeHost, type FeatureId, type ResolvedFeatures } from '../core/features'
import { parseSnippetImport } from '../core/snippets'
import { getDomains, getFeatures, getSnippets, saveSnippets, setDomains, setFeature } from '../shared/storage'
import { STYLES } from '../content/ui/styles'

function Options() {
  const [features, setFeatures] = useState<ResolvedFeatures | null>(null)
  const [domains, setDomainState] = useState<{ user: string[]; managed: string[] }>({ user: [], managed: [] })
  const [newDomain, setNewDomain] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = async () => {
    setFeatures(await getFeatures())
    setDomainState(await getDomains())
  }
  useEffect(() => {
    void reload()
  }, [])

  const toggle = async (id: FeatureId, value: boolean) => {
    await setFeature(id, value)
    await reload()
  }

  const addDomain = async () => {
    const host = normalizeHost(newDomain)
    if (!host) {
      setMessage({ kind: 'error', text: 'Enter a hostname such as canvas.school.edu.' })
      return
    }
    if (!host.endsWith('.instructure.com')) {
      const granted = await chrome.permissions.request({ origins: [`https://${host}/*`] })
      if (!granted) {
        setMessage({ kind: 'error', text: `Chrome did not grant access to ${host}, so the toolkit cannot run there.` })
        return
      }
    }
    await setDomains([...new Set([...domains.user, host])])
    setNewDomain('')
    setMessage({ kind: 'ok', text: `Added ${host}. Reload your Canvas tab.` })
    await reload()
  }

  const removeDomain = async (host: string) => {
    await setDomains(domains.user.filter(d => d !== host))
    await chrome.permissions.remove({ origins: [`https://${host}/*`] }).catch(() => false)
    await reload()
  }

  const exportSnippets = async () => {
    const list = await getSnippets()
    const blob = new Blob([JSON.stringify(list.map(({ title, body, folder, tags }) => ({ title, body, folder, tags })), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'speedgrader-comments.json'
    a.click()
  }

  const importSnippets = async (file: File) => {
    try {
      const imported = parseSnippetImport(await file.text())
      const existing = await getSnippets()
      await saveSnippets([...existing, ...imported])
      setMessage({ kind: 'ok', text: `Imported ${imported.length} comment(s).` })
    } catch (e) {
      setMessage({ kind: 'error', text: `Import failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  if (!features) return null
  const modules = [...new Set(FEATURES.map(f => f.module))]

  return (
    <div className="tk" style={{ maxWidth: 760, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 22 }}>Instructor Toolkit for Canvas</h1>
      <p className="tk-muted">
        Everything runs in your browser with your own Canvas login. The toolkit never stores a Canvas password or API token, and student names and grades never
        leave this browser.
      </p>
      {message && <div className={`tk-alert ${message.kind}`}>{message.text}</div>}

      {modules.map(m => (
        <div className="tk-card" key={m}>
          <h3>{m}</h3>
          {FEATURES.filter(f => f.module === m).map(f => {
            const locked = f.id in features.managed
            return (
              <div className="tk-row" key={f.id}>
                <label className="tk-grow" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={features.enabled[f.id]} disabled={locked} onChange={e => void toggle(f.id, e.target.checked)} />
                  <span>
                    <strong>{f.label}</strong>
                    <br />
                    <span className="tk-muted">{f.description}</span>
                  </span>
                </label>
                {locked && <span className="tk-badge info">Set by your institution</span>}
              </div>
            )
          })}
        </div>
      ))}

      <div className="tk-card">
        <h3>Canvas addresses</h3>
        <p className="tk-muted">The toolkit runs on every *.instructure.com site. If your school uses its own address (for example canvas.school.edu), add it here.</p>
        <ul className="tk-list">
          {domains.managed.map(d => (
            <li key={d} className="tk-row">
              <span className="tk-grow">{d}</span>
              <span className="tk-badge info">Set by your institution</span>
            </li>
          ))}
          {domains.user.map(d => (
            <li key={d} className="tk-row">
              <span className="tk-grow">{d}</span>
              <button className="tk-btn small danger" onClick={() => void removeDomain(d)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="tk-row">
          <input type="text" className="tk-grow" placeholder="canvas.school.edu" aria-label="Canvas address" value={newDomain} onChange={e => setNewDomain(e.target.value)} />
          <button className="tk-btn" onClick={() => void addDomain()}>
            Add
          </button>
        </div>
      </div>

      <div className="tk-card">
        <h3>SpeedGrader comments</h3>
        <p className="tk-muted">Comments sync between your Chrome browsers. Export them to share with colleagues, who can import the file.</p>
        <div className="tk-row">
          <button className="tk-btn" onClick={() => void exportSnippets()}>
            Export comments
          </button>
          <label className="tk-btn">
            Import comments
            <input type="file" accept="application/json" hidden onChange={e => e.target.files?.[0] && void importSnippets(e.target.files[0])} />
          </label>
        </div>
      </div>
    </div>
  )
}

const style = document.createElement('style')
style.textContent = STYLES.replace(':host { all: initial; }', 'body { margin: 0; background: #F6F8F9; }')
document.head.appendChild(style)
createRoot(document.getElementById('root')!).render(<Options />)
