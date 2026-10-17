// Loads everything with a date in a course into one flat table, keyed by module
// order, so the dates editor can show and edit it in one place.

import type { CanvasClient } from './canvasClient'

export type ItemKind = 'Assignment' | 'Quiz' | 'NewQuiz' | 'Discussion' | 'Page' | 'Module'

export interface DateValues {
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
}

export type DateField = keyof DateValues

export const DATE_FIELDS: DateField[] = ['due_at', 'unlock_at', 'lock_at']

export interface OverrideDates extends DateValues {
  id: string
  title: string
}

/** How an item's dates are written back to Canvas. */
export type WritePath =
  | { kind: 'assignment'; assignmentId: string } // assignments/bulk_update
  | { kind: 'quiz'; quizId: string } // quizzes/:id/date_details (ungraded quiz)
  | { kind: 'discussion'; topicId: string } // discussion_topics/:id/date_details (ungraded)
  | { kind: 'module'; moduleId: string } // modules/:id (unlock_at only)
  | { kind: 'none' }

export interface DatedItem {
  key: string
  kind: ItemKind
  title: string
  moduleId: string | null
  moduleName: string | null
  /** Sort key: module position then item position; items in no module sort last. */
  order: [number, number]
  published: boolean
  pointsPossible: number | null
  /** Present for assignment-backed items only. */
  assignmentId: string | null
  postToSis: boolean | null
  base: DateValues
  overrides: OverrideDates[]
  /** False when Canvas omitted all_dates (too many overrides); only base dates are editable then. */
  overridesKnown: boolean
  /** Fields this item supports. */
  fields: DateField[]
  write: WritePath
  htmlUrl: string | null
}

interface ApiAssignment {
  id: string
  name: string
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
  points_possible: number | null
  published: boolean
  post_to_sis?: boolean | null
  html_url: string
  quiz_id?: string
  is_quiz_assignment?: boolean
  is_quiz_lti_assignment?: boolean
  discussion_topic?: { id: string }
  submission_types?: string[]
  all_dates?: Array<DateValues & { id?: string; base?: boolean; title?: string }>
  all_dates_count?: number
  has_overrides?: boolean
}

interface ApiModule {
  id: string
  name: string
  position: number
  unlock_at: string | null
  published?: boolean
  items_count: number
  items?: ApiModuleItem[]
}

export interface ApiModuleItem {
  id: string
  module_id?: string
  position: number
  title: string
  type: 'File' | 'Page' | 'Discussion' | 'Assignment' | 'Quiz' | 'SubHeader' | 'ExternalUrl' | 'ExternalTool'
  content_id?: string
  page_url?: string
  external_url?: string
  html_url?: string
  url?: string
  published?: boolean
}

interface ApiQuiz {
  id: string
  title: string
  assignment_id: string | null
  quiz_type: string
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
  published: boolean
  html_url: string
  points_possible: number | null
}

interface ApiTopic {
  id: string
  title: string
  assignment_id: string | null
  delayed_post_at: string | null
  lock_at: string | null
  published: boolean
  html_url: string
}

interface ApiDateDetails extends Partial<DateValues> {
  overrides?: Array<Partial<DateValues> & { id: string; title?: string }>
}

export interface CourseTable {
  courseId: string
  items: DatedItem[]
  modules: { id: string; name: string; position: number }[]
}

const empty = (v: string | null | undefined) => v ?? null

export async function loadCourseTable(client: CanvasClient, courseId: string): Promise<CourseTable> {
  const c = `/api/v1/courses/${courseId}`
  const [assignments, modules, quizzes, topics] = await Promise.all([
    client.getAll<ApiAssignment>(`${c}/assignments?include[]=all_dates&include[]=overrides`),
    client.getAll<ApiModule>(`${c}/modules?include[]=items`),
    client.getAll<ApiQuiz>(`${c}/quizzes`).catch(() => [] as ApiQuiz[]),
    client.getAll<ApiTopic>(`${c}/discussion_topics`).catch(() => [] as ApiTopic[]),
  ])

  // Large modules come back without items; fetch those separately.
  for (const m of modules) {
    if (!m.items && m.items_count > 0) m.items = await client.getAll<ApiModuleItem>(`${c}/modules/${m.id}/items`)
  }

  const placement = new Map<string, { module: ApiModule; position: number; published: boolean | undefined }>()
  for (const m of modules) {
    for (const it of m.items ?? []) {
      const k = placementKey(it)
      if (k && !placement.has(k)) placement.set(k, { module: m, position: it.position, published: it.published })
    }
  }

  const items: DatedItem[] = []
  const seenQuizzes = new Set<string>()
  const seenTopics = new Set<string>()

  for (const a of assignments) {
    const kind: ItemKind = a.is_quiz_lti_assignment
      ? 'NewQuiz'
      : a.quiz_id
        ? 'Quiz'
        : a.discussion_topic
          ? 'Discussion'
          : 'Assignment'
    if (a.quiz_id) seenQuizzes.add(String(a.quiz_id))
    if (a.discussion_topic) seenTopics.add(String(a.discussion_topic.id))
    const place =
      placement.get(`Assignment:${a.id}`) ??
      (a.quiz_id ? placement.get(`Quiz:${a.quiz_id}`) : undefined) ??
      (a.discussion_topic ? placement.get(`Discussion:${a.discussion_topic.id}`) : undefined)
    const overrides: OverrideDates[] = (a.all_dates ?? [])
      .filter(d => !d.base && d.id)
      .map(d => ({ id: String(d.id), title: d.title ?? 'Override', due_at: empty(d.due_at), unlock_at: empty(d.unlock_at), lock_at: empty(d.lock_at) }))
    items.push({
      key: `assignment:${a.id}`,
      kind,
      title: a.name,
      moduleId: place?.module.id ?? null,
      moduleName: place?.module.name ?? null,
      order: place ? [place.module.position, place.position] : [Number.MAX_SAFE_INTEGER, items.length],
      published: a.published,
      pointsPossible: a.points_possible,
      assignmentId: a.id,
      postToSis: a.post_to_sis ?? null,
      base: { due_at: empty(a.due_at), unlock_at: empty(a.unlock_at), lock_at: empty(a.lock_at) },
      overrides,
      overridesKnown: a.all_dates !== undefined || !a.has_overrides,
      fields: DATE_FIELDS,
      write: { kind: 'assignment', assignmentId: a.id },
      htmlUrl: a.html_url,
    })
  }

  // Ungraded (practice and survey) quizzes are not assignments.
  for (const q of quizzes) {
    if (q.assignment_id || seenQuizzes.has(String(q.id))) continue
    const place = placement.get(`Quiz:${q.id}`)
    const details = await client.get<ApiDateDetails>(`${c}/quizzes/${q.id}/date_details`).catch(() => null)
    items.push({
      key: `quiz:${q.id}`,
      kind: 'Quiz',
      title: q.title,
      moduleId: place?.module.id ?? null,
      moduleName: place?.module.name ?? null,
      order: place ? [place.module.position, place.position] : [Number.MAX_SAFE_INTEGER, items.length],
      published: q.published,
      pointsPossible: q.points_possible,
      assignmentId: null,
      postToSis: null,
      base: { due_at: empty(q.due_at), unlock_at: empty(q.unlock_at), lock_at: empty(q.lock_at) },
      overrides: normalizeOverrides(details),
      overridesKnown: details !== null,
      fields: DATE_FIELDS,
      write: { kind: 'quiz', quizId: q.id },
      htmlUrl: q.html_url,
    })
  }

  // Ungraded discussions have availability dates but no due date.
  for (const t of topics) {
    if (t.assignment_id || seenTopics.has(String(t.id))) continue
    const place = placement.get(`Discussion:${t.id}`)
    const details = await client.get<ApiDateDetails>(`${c}/discussion_topics/${t.id}/date_details`).catch(() => null)
    items.push({
      key: `discussion:${t.id}`,
      kind: 'Discussion',
      title: t.title,
      moduleId: place?.module.id ?? null,
      moduleName: place?.module.name ?? null,
      order: place ? [place.module.position, place.position] : [Number.MAX_SAFE_INTEGER, items.length],
      published: t.published,
      pointsPossible: null,
      assignmentId: null,
      postToSis: null,
      base: { due_at: null, unlock_at: empty(details?.unlock_at ?? t.delayed_post_at), lock_at: empty(details?.lock_at ?? t.lock_at) },
      overrides: normalizeOverrides(details),
      overridesKnown: details !== null,
      fields: ['unlock_at', 'lock_at'],
      write: { kind: 'discussion', topicId: t.id },
      htmlUrl: t.html_url,
    })
  }

  for (const m of modules) {
    items.push({
      key: `module:${m.id}`,
      kind: 'Module',
      title: `Module unlock: ${m.name}`,
      moduleId: m.id,
      moduleName: m.name,
      order: [m.position, -1],
      published: m.published ?? true,
      pointsPossible: null,
      assignmentId: null,
      postToSis: null,
      base: { due_at: null, unlock_at: empty(m.unlock_at), lock_at: null },
      overrides: [],
      overridesKnown: true,
      fields: ['unlock_at'],
      write: { kind: 'module', moduleId: m.id },
      htmlUrl: null,
    })
  }

  items.sort((x, y) => x.order[0] - y.order[0] || x.order[1] - y.order[1])
  return {
    courseId,
    items,
    modules: modules.map(m => ({ id: m.id, name: m.name, position: m.position })).sort((a, b) => a.position - b.position),
  }
}

function placementKey(it: ApiModuleItem): string | null {
  if (it.type === 'Assignment' || it.type === 'Quiz' || it.type === 'Discussion') return `${it.type}:${it.content_id}`
  return null
}

function normalizeOverrides(details: ApiDateDetails | null): OverrideDates[] {
  return (details?.overrides ?? []).map(o => ({
    id: String(o.id),
    title: o.title ?? 'Override',
    due_at: empty(o.due_at),
    unlock_at: empty(o.unlock_at),
    lock_at: empty(o.lock_at),
  }))
}
