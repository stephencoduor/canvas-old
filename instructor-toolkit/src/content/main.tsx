// Content script entry. Runs on Canvas course pages, works out which toolkit
// features apply to this page, and mounts them in a Shadow DOM.

import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { createClient, detectTimeZone, parseRoute, type PageContext } from './context'
import { STYLES } from './ui/styles'
import { getFeatures } from '../shared/storage'
import type { FeatureState } from '../core/features'
import { DatesPanel } from './features/dates/DatesPanel'
import { AuditPanel } from './features/auditor/AuditPanel'
import { SpeedGraderPanel } from './features/speedgrader/SpeedGraderPanel'

type Tab = 'dates' | 'audit'

function App({ ctx, features }: { ctx: PageContext; features: FeatureState }) {
  const speedGrader = ctx.route === 'speedgrader'
  const tabs: Tab[] = speedGrader ? [] : ([features.datesEditor && 'dates', features.auditor && 'audit'].filter(Boolean) as Tab[])
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'dates')

  return (
    <div className="tk">
      {!open && (
        <button className="tk-launcher" aria-expanded={false} onClick={() => setOpen(true)}>
          {speedGrader ? 'SpeedGrader Pro' : 'Toolkit'}
        </button>
      )}
      {open && (
        <section className={`tk-panel ${speedGrader ? 'narrow' : ''}`} aria-label="Instructor Toolkit">
          <div className="tk-head">
            <h2>{speedGrader ? 'SpeedGrader Pro' : 'Instructor Toolkit'}</h2>
            <button className="tk-icon" aria-label="Settings" title="Settings" onClick={() => void chrome.runtime.sendMessage({ type: 'open-options' })}>
              ⚙
            </button>
            <button className="tk-icon" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          {!speedGrader && tabs.length > 1 && (
            <div className="tk-tabs" role="tablist">
              {tabs.map(t => (
                <button key={t} role="tab" className="tk-tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {t === 'dates' ? 'Dates and modules' : 'Course copy audit'}
                </button>
              ))}
            </div>
          )}
          <div className="tk-body">
            {speedGrader && <SpeedGraderPanel ctx={ctx} features={features} />}
            {!speedGrader && tab === 'dates' && features.datesEditor && <DatesPanel ctx={ctx} sisEnabled={features.sisToggle} />}
            {!speedGrader && tab === 'audit' && features.auditor && <AuditPanel ctx={ctx} />}
          </div>
        </section>
      )}
    </div>
  )
}

async function main(): Promise<void> {
  if (window.top !== window) return // never inside Canvas iframes
  if (document.getElementById('instructor-toolkit-root')) return
  const route = parseRoute(location.pathname)
  if (!route) return

  const { enabled } = await getFeatures()
  const sgFeatures = enabled.snippets || enabled.rubricHotkeys || enabled.privateNotes || enabled.keyboardFlow
  if (route.route === 'speedgrader' ? !sgFeatures : !(enabled.datesEditor || enabled.auditor)) return

  const client = createClient(location.origin)
  // Only teachers, TAs and designers get the toolkit; students never see it.
  try {
    const course = await client.get<{ enrollments?: { type: string }[] }>(`/api/v1/courses/${route.courseId}?include[]=permissions`)
    const roles = (course.enrollments ?? []).map(e => e.type)
    const staff = roles.some(r => ['teacher', 'ta', 'designer'].includes(r))
    const perms = (course as { permissions?: Record<string, boolean> }).permissions ?? {}
    if (!staff && !perms.manage_content && !perms.manage_grades && !perms.manage_course_content_edit && !perms.create_announcement) return
  } catch {
    return
  }

  const timeZone = await detectTimeZone(client)
  const ctx: PageContext = { client, host: location.host, origin: location.origin, courseId: route.courseId, route: route.route, timeZone }

  const host = document.createElement('div')
  host.id = 'instructor-toolkit-root'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLES
  shadow.appendChild(style)
  const mount = document.createElement('div')
  shadow.appendChild(mount)
  createRoot(mount).render(<App ctx={ctx} features={enabled} />)
}

void main()
