// Course copy pre-flight auditor. Scans every piece of course content through
// documented endpoints, merges in Canvas's own link validator (an undocumented
// endpoint, so it is optional), and proposes link rewrites where a safe match
// exists in the current course.

import type { CanvasClient } from '../canvasClient'
import { errorText } from '../bulkDates'
import { classifyLink, extractLinks, matchTool, rewriteLink } from './links'

export type Severity = 'error' | 'warning' | 'info'

export type ContentType = 'page' | 'assignment' | 'discussion' | 'announcement' | 'syllabus' | 'quiz' | 'quiz-question' | 'new-quiz-item' | 'module-item'

export interface ContentLocation {
  type: ContentType
  id: string
  title: string
  htmlUrl: string | null
}

export type Category =
  | 'old-course-link'
  | 'missing-file'
  | 'unpublished-file'
  | 'missing-page'
  | 'third-party-tool'
  | 'stale-date'
  | 'unpublished-in-module'
  | 'native-validator'

export interface RewriteFix {
  from: string
  to: string
  label: string
}

export interface Finding {
  id: string
  severity: Severity
  category: Category
  location: ContentLocation
  url: string | null
  detail: string
  fix: RewriteFix | null
}

export interface ContentBlob {
  location: ContentLocation
  html: string
}

export interface AuditOptions {
  canvasOrigin: string
  /** Run Canvas's own validator as well (undocumented endpoint, slower). */
  useNativeValidator: boolean
  /** Look up names in the source course to propose rewrites. */
  resolveFixes: boolean
}

export interface AuditReport {
  courseId: string
  courseName: string
  scannedItems: number
  findings: Finding[]
  /** Parts of the scan that could not run, shown to the user so the report is honest. */
  notes: string[]
}

type Report = (label: string) => void

interface ApiFile {
  id: string
  display_name: string
  filename: string
  size: number
  locked: boolean
  hidden: boolean
}

interface ApiCourse {
  id: string
  name: string
  start_at: string | null
  end_at: string | null
  syllabus_body?: string | null
  term?: { name: string; start_at: string | null; end_at: string | null }
  html_url?: string
}

export async function runAudit(client: CanvasClient, courseId: string, opts: AuditOptions, report: Report = () => {}): Promise<AuditReport> {
  const c = `/api/v1/courses/${courseId}`
  const notes: string[] = []
  report('Reading course')
  const course = await client.get<ApiCourse>(`${c}?include[]=syllabus_body&include[]=term`)

  report('Collecting pages, assignments, discussions and quizzes')
  const blobs = await collectContent(client, courseId, course, notes, report)

  report('Indexing files and pages')
  const files = await client.getAll<ApiFile>(`${c}/files`).catch(() => {
    notes.push('Files could not be listed (the Files tab may be hidden from you), so file checks were skipped.')
    return null
  })
  const fileById = new Map((files ?? []).map(f => [String(f.id), f]))
  const pages = await client.getAll<{ url: string; title: string }>(`${c}/pages`).catch(() => [])
  const pageSlugs = new Set(pages.map(p => p.url))

  const findings: Finding[] = []
  let seq = 0
  const add = (f: Omit<Finding, 'id'>) => findings.push({ ...f, id: `f${++seq}` })

  for (const blob of blobs) {
    const seen = new Set<string>()
    for (const link of extractLinks(blob.html)) {
      if (seen.has(link.url)) continue
      seen.add(link.url)
      const target = classifyLink(link.url, opts.canvasOrigin)
      const label = link.text ? `"${link.text}"` : link.url

      if (target.kind === 'course-content' && target.courseId !== courseId) {
        add({
          severity: 'error',
          category: 'old-course-link',
          location: blob.location,
          url: link.url,
          detail: `${label} points to another course (course ${target.courseId}). Students will get "unauthorized" or see the old course.`,
          fix: null,
        })
      } else if (target.kind === 'file' && target.courseId && target.courseId !== courseId) {
        add({
          severity: 'error',
          category: 'old-course-link',
          location: blob.location,
          url: link.url,
          detail: `${label} is a file in another course (course ${target.courseId}).`,
          fix: null,
        })
      } else if (target.kind === 'file' && files) {
        const file = fileById.get(target.fileId)
        if (!file && (target.courseId === courseId || target.courseId === null)) {
          // User files (/users/x/files) are legitimately outside the course list.
          if (target.courseId === courseId) {
            add({ severity: 'error', category: 'missing-file', location: blob.location, url: link.url, detail: `${label} links to a file that no longer exists in this course.`, fix: null })
          }
        } else if (file && (file.locked || file.hidden)) {
          add({
            severity: 'warning',
            category: 'unpublished-file',
            location: blob.location,
            url: link.url,
            detail: `${file.display_name} is ${file.locked ? 'unpublished' : 'hidden'}, so students cannot open it from here.`,
            fix: null,
          })
        }
      } else if (target.kind === 'course-content' && target.contentType === 'pages' && pages.length && !pageSlugs.has(target.contentId)) {
        add({ severity: 'warning', category: 'missing-page', location: blob.location, url: link.url, detail: `${label} links to a page that does not exist in this course.`, fix: null })
      } else if (target.kind === 'lti-launch' || target.kind === 'external') {
        const tool = matchTool(target.kind === 'lti-launch' ? target.url : link.url)
        if (tool && (target.kind === 'lti-launch' || tool.vendor !== 'YouTube')) {
          add({
            severity: target.kind === 'lti-launch' ? tool.severity : 'info',
            category: 'third-party-tool',
            location: blob.location,
            url: link.url,
            detail: `${tool.vendor}: ${tool.advice}`,
            fix: null,
          })
        }
      }
    }
  }

  report('Checking modules')
  await auditModules(client, courseId, add, notes)

  report('Checking dates')
  await auditDates(client, courseId, course, add)

  if (opts.useNativeValidator) {
    report("Running Canvas's link validator")
    try {
      for (const f of await nativeValidator(client, courseId)) {
        if (findings.some(x => x.url === f.url && x.location.title === f.location.title)) continue
        add(f)
      }
    } catch (e) {
      notes.push(`Canvas's own link validator could not run (${errorText(e)}). The toolkit's own scan above is still complete.`)
    }
  }

  if (opts.resolveFixes) {
    report('Looking for matching items to fix old-course links')
    await proposeFixes(client, courseId, findings, opts.canvasOrigin, files ?? [], pages)
  }

  findings.sort((a, b) => rank(a.severity) - rank(b.severity))
  return { courseId, courseName: course.name, scannedItems: blobs.length, findings, notes }
}

const rank = (s: Severity) => (s === 'error' ? 0 : s === 'warning' ? 1 : 2)

async function collectContent(client: CanvasClient, courseId: string, course: ApiCourse, notes: string[], report: Report): Promise<ContentBlob[]> {
  const c = `/api/v1/courses/${courseId}`
  const blobs: ContentBlob[] = []
  const soft = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn()
    } catch (e) {
      notes.push(`${label} could not be read (${errorText(e)}).`)
      return []
    }
  }

  if (course.syllabus_body) {
    blobs.push({ location: { type: 'syllabus', id: courseId, title: 'Syllabus', htmlUrl: `/courses/${courseId}/assignments/syllabus` }, html: course.syllabus_body })
  }

  const pages = await soft('Pages', () => client.getAll<{ url: string; title: string; body?: string; html_url: string }>(`${c}/pages?include[]=body`))
  for (const p of pages) {
    let body = p.body
    if (body === undefined) body = (await client.get<{ body: string }>(`${c}/pages/${encodeURIComponent(p.url)}`).catch(() => ({ body: '' }))).body
    blobs.push({ location: { type: 'page', id: p.url, title: p.title, htmlUrl: p.html_url }, html: body ?? '' })
  }

  const assignments = await soft('Assignments', () =>
    client.getAll<{ id: string; name: string; description: string | null; html_url: string; quiz_id?: string; discussion_topic?: unknown; is_quiz_lti_assignment?: boolean }>(`${c}/assignments`),
  )
  for (const a of assignments) {
    if (a.quiz_id || a.discussion_topic) continue // scanned as quiz or discussion
    blobs.push({ location: { type: 'assignment', id: a.id, title: a.name, htmlUrl: a.html_url }, html: a.description ?? '' })
  }

  const topics = await soft('Discussions', () => client.getAll<{ id: string; title: string; message: string | null; html_url: string }>(`${c}/discussion_topics`))
  for (const t of topics) blobs.push({ location: { type: 'discussion', id: t.id, title: t.title, htmlUrl: t.html_url }, html: t.message ?? '' })

  const announcements = await soft('Announcements', () =>
    client.getAll<{ id: string; title: string; message: string | null; html_url: string }>(`${c}/discussion_topics?only_announcements=true`),
  )
  for (const t of announcements) blobs.push({ location: { type: 'announcement', id: t.id, title: t.title, htmlUrl: t.html_url }, html: t.message ?? '' })

  const quizzes = await soft('Classic quizzes', () => client.getAll<{ id: string; title: string; description: string | null; html_url: string }>(`${c}/quizzes`))
  for (const [i, q] of quizzes.entries()) {
    report(`Reading quiz ${i + 1} of ${quizzes.length}`)
    blobs.push({ location: { type: 'quiz', id: q.id, title: q.title, htmlUrl: q.html_url }, html: q.description ?? '' })
    const questions = await client.getAll<{ id: string; question_name: string; question_text: string }>(`${c}/quizzes/${q.id}/questions`).catch(() => [])
    for (const qq of questions) {
      blobs.push({ location: { type: 'quiz-question', id: `${q.id}:${qq.id}`, title: `${q.title} › ${qq.question_name || 'Question'}`, htmlUrl: q.html_url }, html: qq.question_text ?? '' })
    }
  }

  // New Quizzes: items placed in a quiz are readable; item banks are not exposed by Canvas.
  const newQuizzes = assignments.filter(a => a.is_quiz_lti_assignment)
  let newQuizFailures = 0
  for (const nq of newQuizzes) {
    try {
      const items = await client.getAll<{ id: string; entry?: { title?: string; item_body?: string } }>(`/api/quiz/v1/courses/${courseId}/quizzes/${nq.id}/items`)
      for (const it of items) {
        blobs.push({ location: { type: 'new-quiz-item', id: `${nq.id}:${it.id}`, title: `${nq.name} › ${it.entry?.title || 'Item'}`, htmlUrl: nq.html_url }, html: it.entry?.item_body ?? '' })
      }
    } catch {
      newQuizFailures++
    }
  }
  if (newQuizzes.length) {
    notes.push(
      newQuizFailures
        ? `${newQuizFailures} of ${newQuizzes.length} New Quizzes could not be read. Item banks are never visible to outside tools, so questions only in banks are not checked.`
        : 'New Quizzes questions placed in quizzes were checked. Questions that live only in item banks are not visible to outside tools.',
    )
  }
  return blobs
}

interface ApiModuleWithItems {
  id: string
  name: string
  published?: boolean
  items?: Array<{ id: string; title: string; type: string; published?: boolean; external_url?: string; html_url?: string; url?: string; content_id?: string }>
  items_count: number
}

async function auditModules(client: CanvasClient, courseId: string, add: (f: Omit<Finding, 'id'>) => void, notes: string[]): Promise<void> {
  const c = `/api/v1/courses/${courseId}`
  let modules: ApiModuleWithItems[]
  try {
    modules = await client.getAll<ApiModuleWithItems>(`${c}/modules?include[]=items&include[]=content_details`)
  } catch (e) {
    notes.push(`Modules could not be read (${errorText(e)}).`)
    return
  }
  for (const m of modules) {
    const items = m.items ?? (m.items_count ? await client.getAll<NonNullable<ApiModuleWithItems['items']>[number]>(`${c}/modules/${m.id}/items`).catch(() => []) : [])
    for (const it of items) {
      const location: ContentLocation = { type: 'module-item', id: it.id, title: `${m.name} › ${it.title}`, htmlUrl: it.html_url ?? null }
      if (m.published !== false && it.published === false && it.type !== 'SubHeader') {
        add({ severity: 'warning', category: 'unpublished-in-module', location, url: null, detail: `"${it.title}" is unpublished inside the published module "${m.name}".`, fix: null })
      }
      if (it.type === 'ExternalTool' || it.type === 'ExternalUrl') {
        const tool = matchTool(it.external_url ?? '')
        if (tool && tool.vendor !== 'YouTube') {
          add({
            severity: it.type === 'ExternalTool' ? tool.severity : 'info',
            category: 'third-party-tool',
            location,
            url: it.external_url ?? null,
            detail: `${tool.vendor}: ${tool.advice}`,
            fix: null,
          })
        }
      }
    }
  }
}

async function auditDates(client: CanvasClient, courseId: string, course: ApiCourse, add: (f: Omit<Finding, 'id'>) => void): Promise<void> {
  const start = course.start_at ?? course.term?.start_at ?? null
  if (!start) return
  const startMs = Date.parse(start)
  const assignments = await client
    .getAll<{ id: string; name: string; due_at: string | null; unlock_at: string | null; html_url: string }>(`/api/v1/courses/${courseId}/assignments`)
    .catch(() => [])
  for (const a of assignments) {
    const dated = a.due_at ?? a.unlock_at
    if (dated && Date.parse(dated) < startMs) {
      add({
        severity: 'warning',
        category: 'stale-date',
        location: { type: 'assignment', id: a.id, title: a.name, htmlUrl: a.html_url },
        url: null,
        detail: `Dated ${dated.slice(0, 10)}, before this course starts (${start.slice(0, 10)}). It probably still has last term's dates; use the Dates editor to shift them.`,
        fix: null,
      })
    }
  }
}

interface ValidationResult {
  state?: string
  workflow_state?: string
  results?: Array<{ name: string; type: string; content_url: string; invalid_links: Array<{ url: string; reason: string; link_text?: string }> }>
}

const REASONS: Record<string, string> = {
  missing_item: 'points to content that has been deleted',
  unpublished_item: 'points to unpublished content',
  course_mismatch: 'points to another course',
  broken_link: 'returned an error when Canvas tried it',
  unreachable: 'could not be reached',
  deleted: 'points to content that has been deleted',
}

/** Canvas's built-in validator. Undocumented: POST starts a job, GET returns its last result. */
export async function nativeValidator(client: CanvasClient, courseId: string, maxPolls = 60): Promise<Omit<Finding, 'id'>[]> {
  const path = `/api/v1/courses/${courseId}/link_validation`
  await client.post(path, {})
  let result: ValidationResult = {}
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 2000))
    result = await client.get<ValidationResult>(path)
    const state = result.state ?? result.workflow_state
    if (state === 'completed' || state === 'failed') break
  }
  const out: Omit<Finding, 'id'>[] = []
  for (const r of result.results ?? []) {
    for (const l of r.invalid_links ?? []) {
      out.push({
        severity: l.reason === 'unpublished_item' ? 'warning' : 'error',
        category: 'native-validator',
        location: { type: 'page', id: r.content_url, title: r.name, htmlUrl: r.content_url },
        url: l.url,
        detail: `${l.link_text ? `"${l.link_text}"` : l.url} ${REASONS[l.reason] ?? l.reason} (found by Canvas's link validator).`,
        fix: null,
      })
    }
  }
  return out
}

/** For old-course links, finds the item with the same name in this course. */
async function proposeFixes(
  client: CanvasClient,
  courseId: string,
  findings: Finding[],
  origin: string,
  files: ApiFile[],
  pages: { url: string; title: string }[],
): Promise<void> {
  const cache = new Map<string, Promise<string | null>>()
  const titleCache = new Map<string, Promise<Map<string, string>>>()
  const currentTitles = (type: string) => {
    if (!titleCache.has(type)) {
      const path = `/api/v1/courses/${courseId}/${type}`
      titleCache.set(
        type,
        client
          .getAll<{ id: string; name?: string; title?: string }>(path)
          .then(list => new Map(list.map(x => [(x.name ?? x.title ?? '').trim(), String(x.id)])))
          .catch(() => new Map()),
      )
    }
    return titleCache.get(type)!
  }

  for (const f of findings) {
    if (f.category !== 'old-course-link' || !f.url) continue
    const target = classifyLink(f.url, origin)
    try {
      if (target.kind === 'file' && target.courseId) {
        const key = `file:${target.fileId}`
        if (!cache.has(key)) cache.set(key, client.get<ApiFile>(`/api/v1/files/${target.fileId}`).then(x => x.display_name).catch(() => null))
        const name = await cache.get(key)!
        const match = name ? files.find(x => x.display_name === name) : undefined
        if (match) {
          f.fix = { from: `/courses/${target.courseId}/files/${target.fileId}`, to: `/courses/${courseId}/files/${match.id}`, label: `Use "${match.display_name}" in this course` }
        }
      } else if (target.kind === 'course-content') {
        const old = target.courseId
        if (target.contentType === 'pages') {
          if (pages.some(p => p.url === target.contentId)) {
            f.fix = { from: `/courses/${old}/pages/${target.contentId}`, to: `/courses/${courseId}/pages/${target.contentId}`, label: 'Use the page with the same name in this course' }
          }
        } else if (['assignments', 'quizzes', 'discussion_topics'].includes(target.contentType)) {
          const key = `${target.contentType}:${old}:${target.contentId}`
          if (!cache.has(key)) {
            cache.set(
              key,
              client
                .get<{ name?: string; title?: string }>(`/api/v1/courses/${old}/${target.contentType}/${target.contentId}`)
                .then(x => (x.name ?? x.title ?? '').trim() || null)
                .catch(() => null),
            )
          }
          const name = await cache.get(key)!
          const newId = name ? (await currentTitles(target.contentType)).get(name) : undefined
          if (newId) {
            f.fix = {
              from: `/courses/${old}/${target.contentType}/${target.contentId}`,
              to: `/courses/${courseId}/${target.contentType}/${newId}`,
              label: `Use "${name}" in this course`,
            }
          }
        } else if (target.contentType === 'course' || target.contentType === 'modules') {
          if (target.contentType === 'course' && !/\/\d+/.test(target.rest)) {
            f.fix = { from: `/courses/${old}`, to: `/courses/${courseId}`, label: 'Point at this course instead' }
          }
        }
      }
    } catch {
      // A failed lookup just means no automatic fix; the finding stays.
    }
  }
}

/** Content types the toolkit can rewrite in place. */
export function isFixable(type: ContentType): boolean {
  return ['page', 'assignment', 'discussion', 'announcement', 'syllabus', 'quiz'].includes(type)
}

/** Applies every chosen rewrite, one write per content item, re-reading the content first. */
export async function applyFixes(
  client: CanvasClient,
  courseId: string,
  findings: Finding[],
  report: (done: number, total: number) => void = () => {},
): Promise<{ fixed: Finding[]; failed: { finding: Finding; error: string }[] }> {
  const c = `/api/v1/courses/${courseId}`
  const byLocation = new Map<string, Finding[]>()
  for (const f of findings) {
    if (!f.fix || !isFixable(f.location.type)) continue
    const key = `${f.location.type}:${f.location.id}`
    byLocation.set(key, [...(byLocation.get(key) ?? []), f])
  }
  const fixed: Finding[] = []
  const failed: { finding: Finding; error: string }[] = []
  let done = 0
  for (const group of byLocation.values()) {
    const loc = group[0]!.location
    try {
      const { html, save } = await contentAccessor(client, c, loc)
      let updated = await html()
      for (const f of group) updated = rewriteLink(updated, f.fix!.from, f.fix!.to)
      await save(updated)
      fixed.push(...group)
    } catch (e) {
      for (const f of group) failed.push({ finding: f, error: errorText(e) })
    }
    report(++done, byLocation.size)
  }
  return { fixed, failed }
}

async function contentAccessor(client: CanvasClient, c: string, loc: ContentLocation): Promise<{ html: () => Promise<string>; save: (h: string) => Promise<unknown> }> {
  switch (loc.type) {
    case 'page': {
      const p = `${c}/pages/${encodeURIComponent(loc.id)}`
      return { html: async () => (await client.get<{ body: string }>(p)).body ?? '', save: h => client.put(p, { wiki_page: { body: h } }) }
    }
    case 'assignment': {
      const p = `${c}/assignments/${loc.id}`
      return { html: async () => (await client.get<{ description: string }>(p)).description ?? '', save: h => client.put(p, { assignment: { description: h } }) }
    }
    case 'discussion':
    case 'announcement': {
      const p = `${c}/discussion_topics/${loc.id}`
      return { html: async () => (await client.get<{ message: string }>(p)).message ?? '', save: h => client.put(p, { message: h }) }
    }
    case 'syllabus':
      return {
        html: async () => (await client.get<{ syllabus_body: string }>(`${c}?include[]=syllabus_body`)).syllabus_body ?? '',
        save: h => client.put(c, { course: { syllabus_body: h } }),
      }
    case 'quiz': {
      const p = `${c}/quizzes/${loc.id}`
      return { html: async () => (await client.get<{ description: string }>(p)).description ?? '', save: h => client.put(p, { quiz: { description: h } }) }
    }
    default:
      throw new Error(`${loc.type} cannot be edited automatically`)
  }
}

export function findingsToCsv(report: AuditReport): string {
  const esc = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`
  const rows = [['Severity', 'Category', 'Where', 'Type', 'Link', 'Problem', 'Suggested fix', 'Open'].map(esc).join(',')]
  for (const f of report.findings) {
    rows.push(
      [f.severity, f.category, f.location.title, f.location.type, f.url, f.detail, f.fix ? `${f.fix.label}: ${f.fix.from} -> ${f.fix.to}` : '', f.location.htmlUrl]
        .map(v => esc(v))
        .join(','),
    )
  }
  return rows.join('\r\n')
}
