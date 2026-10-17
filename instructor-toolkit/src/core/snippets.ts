// SpeedGrader comment snippets: storage-agnostic model, search and variables.

export interface Snippet {
  id: string
  title: string
  body: string
  folder: string
  tags: string[]
  /** Snippets pushed by the institution are shown but cannot be edited. */
  readOnly?: boolean
  uses?: number
}

export interface SnippetContext {
  firstName?: string
  lastName?: string
  fullName?: string
  score?: number | string | null
  pointsPossible?: number | null
  assignment?: string
  course?: string
  teacher?: string
}

export const VARIABLES: { name: string; description: string }[] = [
  { name: 'first_name', description: "Student's first name" },
  { name: 'last_name', description: "Student's last name" },
  { name: 'full_name', description: "Student's full name" },
  { name: 'score', description: 'Current score' },
  { name: 'points_possible', description: 'Points possible' },
  { name: 'percent', description: 'Score as a percentage' },
  { name: 'assignment', description: 'Assignment name' },
  { name: 'course', description: 'Course name' },
  { name: 'teacher', description: 'Your name' },
]

/** Fills {variables}. Unknown or empty variables are left visible so nothing is posted silently wrong. */
export function renderSnippet(body: string, ctx: SnippetContext): { text: string; missing: string[] } {
  const missing: string[] = []
  const score = ctx.score === null || ctx.score === undefined || ctx.score === '' ? null : Number(ctx.score)
  const values: Record<string, string | null> = {
    first_name: ctx.firstName ?? null,
    last_name: ctx.lastName ?? null,
    full_name: ctx.fullName ?? null,
    score: score === null || Number.isNaN(score) ? null : trimNumber(score),
    points_possible: ctx.pointsPossible === null || ctx.pointsPossible === undefined ? null : trimNumber(ctx.pointsPossible),
    percent: score !== null && !Number.isNaN(score) && ctx.pointsPossible ? `${Math.round((score / ctx.pointsPossible) * 100)}%` : null,
    assignment: ctx.assignment ?? null,
    course: ctx.course ?? null,
    teacher: ctx.teacher ?? null,
  }
  const text = body.replace(/\{\s*([a-z_]+)\s*\}/gi, (whole, rawName: string) => {
    const name = rawName.toLowerCase()
    if (!(name in values)) return whole
    const v = values[name] ?? null
    if (v === null || v === '') {
      missing.push(name)
      return whole
    }
    return v as string
  })
  return { text, missing: [...new Set(missing)] }
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/** Ranks snippets: title matches first, then tag and folder, then body; frequently used first on ties. */
export function searchSnippets(snippets: Snippet[], query: string): Snippet[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...snippets].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0) || a.title.localeCompare(b.title))
  const terms = q.split(/\s+/)
  const scored: { s: Snippet; score: number }[] = []
  for (const s of snippets) {
    let score = 0
    for (const t of terms) {
      if (t.startsWith('#')) {
        if (s.tags.some(tag => tag.toLowerCase() === t.slice(1))) score += 5
        else {
          score = -1
          break
        }
        continue
      }
      let hit = 0
      if (s.title.toLowerCase().includes(t)) hit = 4
      else if (s.tags.some(tag => tag.toLowerCase().includes(t)) || s.folder.toLowerCase().includes(t)) hit = 2
      else if (s.body.toLowerCase().includes(t)) hit = 1
      if (!hit) {
        score = -1
        break
      }
      score += hit
    }
    if (score > 0) scored.push({ s, score })
  }
  return scored.sort((a, b) => b.score - a.score || (b.s.uses ?? 0) - (a.s.uses ?? 0)).map(x => x.s)
}

export function newSnippetId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Import format: a JSON array of {title, body, folder?, tags?}. Returns valid snippets only. */
export function parseSnippetImport(json: string): Snippet[] {
  const data: unknown = JSON.parse(json)
  if (!Array.isArray(data)) throw new Error('Expected a JSON array of snippets')
  const out: Snippet[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.body !== 'string' || !r.body.trim()) continue
    out.push({
      id: newSnippetId(),
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : r.body.slice(0, 40),
      body: r.body,
      folder: typeof r.folder === 'string' ? r.folder : 'Imported',
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    })
  }
  return out
}

export const STARTER_SNIPPETS: Snippet[] = [
  { id: 'starter-1', title: 'Great work', body: 'Great work on {assignment}, {first_name}! You earned {score}/{points_possible}.', folder: 'Praise', tags: ['positive'] },
  { id: 'starter-2', title: 'Cite sources', body: 'Remember to cite your sources using the required format. See the syllabus for examples.', folder: 'Writing', tags: ['citations'] },
  { id: 'starter-3', title: 'Late submission', body: 'This was submitted after the due date, so the late policy has been applied.', folder: 'Policy', tags: ['late'] },
  { id: 'starter-4', title: 'Office hours', body: "{first_name}, let's talk about this in office hours. I think a quick conversation will help.", folder: 'Support', tags: ['follow-up'] },
]
