// chrome.storage wrappers. Sync storage holds small user settings and snippets;
// local storage holds the undo journal and private notes, which never leave
// this browser; managed storage is the institution's read-only policy.

import { resolveFeatures, type FeatureState, type ResolvedFeatures } from '../core/features'
import type { Snippet } from '../core/snippets'
import { STARTER_SNIPPETS } from '../core/snippets'
import type { DateSnapshot } from '../core/bulkDates'
import { DEFAULT_SIS_RULES, type SisRules } from '../core/sis'

export interface ManagedPolicy {
  canvasDomains?: string[]
  features?: Partial<FeatureState>
  licenseKey?: string
  backendUrl?: string
  snippetLibrary?: Array<{ title: string; body: string; folder?: string; tags?: string[] }>
}

export async function getManaged(): Promise<ManagedPolicy> {
  try {
    return ((await chrome.storage.managed.get(null)) as ManagedPolicy) ?? {}
  } catch {
    // Managed storage is unavailable outside enterprise-managed browsers.
    return {}
  }
}

export async function getFeatures(): Promise<ResolvedFeatures> {
  const [{ features }, managed] = await Promise.all([chrome.storage.sync.get('features'), getManaged()])
  return resolveFeatures(features as Partial<FeatureState> | undefined, managed.features)
}

export async function setFeature(id: keyof FeatureState, value: boolean): Promise<void> {
  const { features } = await chrome.storage.sync.get('features')
  await chrome.storage.sync.set({ features: { ...(features ?? {}), [id]: value } })
}

export async function getDomains(): Promise<{ user: string[]; managed: string[] }> {
  const [{ domains }, managed] = await Promise.all([chrome.storage.sync.get('domains'), getManaged()])
  return { user: (domains as string[] | undefined) ?? [], managed: managed.canvasDomains ?? [] }
}

export async function setDomains(domains: string[]): Promise<void> {
  await chrome.storage.sync.set({ domains })
}

/** Snippets are split across keys because chrome.storage.sync limits each item to 8 KB. */
const SNIPPET_CHUNK = 'snippets_'

export async function getSnippets(): Promise<Snippet[]> {
  const all = await chrome.storage.sync.get(null)
  const keys = Object.keys(all).filter(k => k.startsWith(SNIPPET_CHUNK)).sort((a, b) => Number(a.slice(SNIPPET_CHUNK.length)) - Number(b.slice(SNIPPET_CHUNK.length)))
  if (!keys.length && !all.snippetsInitialised) return STARTER_SNIPPETS
  return keys.flatMap(k => all[k] as Snippet[])
}

export async function saveSnippets(snippets: Snippet[]): Promise<void> {
  const own = snippets.filter(s => !s.readOnly)
  const chunks: Snippet[][] = []
  let current: Snippet[] = []
  let size = 0
  for (const s of own) {
    const n = JSON.stringify(s).length
    if (size + n > 7000 && current.length) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(s)
    size += n
  }
  if (current.length) chunks.push(current)
  const existing = Object.keys(await chrome.storage.sync.get(null)).filter(k => k.startsWith(SNIPPET_CHUNK))
  const next: Record<string, unknown> = { snippetsInitialised: true }
  chunks.forEach((c, i) => (next[`${SNIPPET_CHUNK}${i}`] = c))
  await chrome.storage.sync.set(next)
  const stale = existing.filter(k => !(k in next))
  if (stale.length) await chrome.storage.sync.remove(stale)
}

export async function getInstitutionSnippets(): Promise<Snippet[]> {
  const managed = await getManaged()
  return (managed.snippetLibrary ?? []).map((s, i) => ({
    id: `managed-${i}`,
    title: s.title,
    body: s.body,
    folder: s.folder ?? 'Department',
    tags: s.tags ?? [],
    readOnly: true,
  }))
}

export interface UndoEntry {
  id: string
  courseId: string
  createdAt: string
  label: string
  snapshots: Record<string, DateSnapshot>
}

const undoKey = (host: string, courseId: string) => `undo:${host}:${courseId}`
const MAX_UNDO = 10

export async function getUndo(host: string, courseId: string): Promise<UndoEntry[]> {
  const key = undoKey(host, courseId)
  return ((await chrome.storage.local.get(key))[key] as UndoEntry[] | undefined) ?? []
}

export async function pushUndo(host: string, entry: UndoEntry): Promise<void> {
  const key = undoKey(host, entry.courseId)
  const list = await getUndo(host, entry.courseId)
  await chrome.storage.local.set({ [key]: [entry, ...list].slice(0, MAX_UNDO) })
}

export async function removeUndo(host: string, courseId: string, id: string): Promise<void> {
  const key = undoKey(host, courseId)
  const list = await getUndo(host, courseId)
  await chrome.storage.local.set({ [key]: list.filter(e => e.id !== id) })
}

const noteKey = (host: string, courseId: string, userId: string) => `note:${host}:${courseId}:${userId}`

export async function getNote(host: string, courseId: string, userId: string): Promise<string> {
  const key = noteKey(host, courseId, userId)
  return ((await chrome.storage.local.get(key))[key] as string | undefined) ?? ''
}

export async function setNote(host: string, courseId: string, userId: string, text: string): Promise<void> {
  const key = noteKey(host, courseId, userId)
  if (text.trim()) await chrome.storage.local.set({ [key]: text })
  else await chrome.storage.local.remove(key)
}

export async function getSisRules(): Promise<SisRules> {
  const { sisRules } = await chrome.storage.sync.get('sisRules')
  return { ...DEFAULT_SIS_RULES, ...((sisRules as Partial<SisRules>) ?? {}) }
}

export async function setSisRules(rules: SisRules): Promise<void> {
  await chrome.storage.sync.set({ sisRules: rules })
}
