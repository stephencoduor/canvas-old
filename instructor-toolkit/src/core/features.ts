// Feature switches. Three layers, lowest to highest precedence: built-in
// defaults, the teacher's own choices (chrome.storage.sync), and the
// institution's managed policy (chrome.storage.managed), which always wins.

export type FeatureId = 'datesEditor' | 'sisToggle' | 'auditor' | 'snippets' | 'rubricHotkeys' | 'privateNotes' | 'keyboardFlow'

export interface FeatureInfo {
  id: FeatureId
  module: 'Dates and Modules' | 'Course Copy Auditor' | 'SpeedGrader Pro'
  label: string
  description: string
  default: boolean
}

export const FEATURES: FeatureInfo[] = [
  { id: 'datesEditor', module: 'Dates and Modules', label: 'Dates and modules editor', description: 'Shift, set or clear due, availability and module unlock dates in bulk, with preview and undo.', default: true },
  { id: 'sisToggle', module: 'Dates and Modules', label: 'Bulk Sync to SIS', description: 'Turn "Sync to SIS" on or off for many assignments at once, after checking your SIS rules.', default: true },
  { id: 'auditor', module: 'Course Copy Auditor', label: 'Course copy auditor', description: 'Find links to old courses, missing or unpublished files, Google and Microsoft items that break after a copy, and stale dates.', default: true },
  { id: 'snippets', module: 'SpeedGrader Pro', label: 'Comment snippets', description: 'Searchable comment library with variables like {first_name} and {score}.', default: true },
  { id: 'rubricHotkeys', module: 'SpeedGrader Pro', label: 'Rubric hotkeys', description: 'Score rubrics from the keyboard: 1-9 picks a rating, Alt+F full marks, Alt+H half marks.', default: true },
  { id: 'privateNotes', module: 'SpeedGrader Pro', label: 'Private student notes', description: 'Notes about each student that only you can see, kept in this browser.', default: true },
  { id: 'keyboardFlow', module: 'SpeedGrader Pro', label: 'Keyboard grading flow', description: 'Focus the grade box on each student; Alt+Enter saves and moves to the next student.', default: false },
]

export type FeatureState = Record<FeatureId, boolean>

export interface ResolvedFeatures {
  enabled: FeatureState
  /** Features the institution has locked; the options page shows them as managed. */
  managed: Partial<Record<FeatureId, boolean>>
}

export function resolveFeatures(user: Partial<FeatureState> | undefined, managed: Partial<FeatureState> | undefined): ResolvedFeatures {
  const enabled = {} as FeatureState
  const locked: Partial<Record<FeatureId, boolean>> = {}
  for (const f of FEATURES) {
    let value = f.default
    if (user && typeof user[f.id] === 'boolean') value = user[f.id]!
    if (managed && typeof managed[f.id] === 'boolean') {
      value = managed[f.id]!
      locked[f.id] = value
    }
    enabled[f.id] = value
  }
  return { enabled, managed: locked }
}

/** Normalises a hostname typed by a user or pushed by policy. Returns null if it is not a plain host. */
export function normalizeHost(input: string): string | null {
  let s = input.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null
  return s
}
