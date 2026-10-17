// Rubric hotkeys as a pure reducer: key presses change a draft assessment,
// which is then saved through the submissions API in one request.

export interface RubricRating {
  id: string
  points: number
  description: string
}

export interface RubricCriterion {
  id: string
  description: string
  points: number
  ratings: RubricRating[]
}

export interface CriterionScore {
  points: number | null
  ratingId: string | null
  comments: string
}

export interface RubricDraft {
  criteria: RubricCriterion[]
  scores: Record<string, CriterionScore>
  focus: number
  dirty: boolean
}

export function newDraft(criteria: RubricCriterion[], existing: Record<string, Partial<CriterionScore>> = {}): RubricDraft {
  const scores: Record<string, CriterionScore> = {}
  for (const c of criteria) {
    const e = existing[c.id]
    scores[c.id] = { points: e?.points ?? null, ratingId: e?.ratingId ?? null, comments: e?.comments ?? '' }
  }
  return { criteria: criteria.map(c => ({ ...c, ratings: sortRatings(c.ratings) })), scores, focus: 0, dirty: false }
}

/** Highest rating first, so key 1 is always the top rating. */
function sortRatings(r: RubricRating[]): RubricRating[] {
  return [...r].sort((a, b) => b.points - a.points)
}

export type RubricAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'focus'; index: number }
  | { type: 'rate'; n: number } // 1-based rating in the focused criterion
  | { type: 'full' } // every criterion to full marks
  | { type: 'half' } // focused criterion to half its points
  | { type: 'clear' } // focused criterion
  | { type: 'points'; points: number }
  | { type: 'saved' }

export function reduce(d: RubricDraft, a: RubricAction): RubricDraft {
  const n = d.criteria.length
  if (!n) return d
  const crit = d.criteria[d.focus]!
  const set = (id: string, v: CriterionScore): RubricDraft => ({ ...d, scores: { ...d.scores, [id]: v }, dirty: true })
  switch (a.type) {
    case 'next':
      return { ...d, focus: Math.min(n - 1, d.focus + 1) }
    case 'prev':
      return { ...d, focus: Math.max(0, d.focus - 1) }
    case 'focus':
      return { ...d, focus: Math.max(0, Math.min(n - 1, a.index)) }
    case 'rate': {
      const r = crit.ratings[a.n - 1]
      if (!r) return d
      const next = set(crit.id, { ...d.scores[crit.id]!, points: r.points, ratingId: r.id })
      // Rating a criterion moves on to the next one, the fastest flow for long rubrics.
      return { ...next, focus: Math.min(n - 1, d.focus + 1) }
    }
    case 'full': {
      const scores = { ...d.scores }
      for (const c of d.criteria) scores[c.id] = { ...scores[c.id]!, points: c.points, ratingId: c.ratings[0]?.points === c.points ? c.ratings[0]!.id : null }
      return { ...d, scores, dirty: true }
    }
    case 'half':
      return set(crit.id, { ...d.scores[crit.id]!, points: crit.points / 2, ratingId: matchRating(crit, crit.points / 2) })
    case 'clear':
      return set(crit.id, { ...d.scores[crit.id]!, points: null, ratingId: null })
    case 'points':
      return set(crit.id, { ...d.scores[crit.id]!, points: a.points, ratingId: matchRating(crit, a.points) })
    case 'saved':
      return { ...d, dirty: false }
  }
}

function matchRating(c: RubricCriterion, points: number): string | null {
  return c.ratings.find(r => r.points === points)?.id ?? null
}

export function total(d: RubricDraft): number {
  return Object.values(d.scores).reduce((sum, s) => sum + (s.points ?? 0), 0)
}

/** Maps a keyboard event to an action. Returns null for keys the hotkeys do not own. */
export function keyToAction(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): RubricAction | null {
  if (e.ctrlKey || e.metaKey) return null
  if (e.altKey) {
    const k = e.key.toLowerCase()
    if (k === 'f' || k === 'ƒ') return { type: 'full' }
    if (k === 'h' || k === '˙') return { type: 'half' }
    if (k === 'backspace') return { type: 'clear' }
    return null
  }
  if (/^[1-9]$/.test(e.key)) return { type: 'rate', n: Number(e.key) }
  if (e.key === 'ArrowDown' || e.key === ']') return { type: 'next' }
  if (e.key === 'ArrowUp' || e.key === '[') return { type: 'prev' }
  return null
}

/** Body for PUT /courses/:id/assignments/:aid/submissions/:uid. */
export function assessmentPayload(d: RubricDraft): { rubric_assessment: Record<string, { points?: number; rating_id?: string; comments?: string }> } {
  const ra: Record<string, { points?: number; rating_id?: string; comments?: string }> = {}
  for (const c of d.criteria) {
    const s = d.scores[c.id]!
    const entry: { points?: number; rating_id?: string; comments?: string } = {}
    if (s.points !== null) entry.points = s.points
    if (s.ratingId) entry.rating_id = s.ratingId
    if (s.comments) entry.comments = s.comments
    ra[c.id] = entry
  }
  return { rubric_assessment: ra }
}
