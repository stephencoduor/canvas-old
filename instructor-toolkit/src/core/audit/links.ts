// Pure link extraction and classification for course content HTML. No DOM
// dependency: a small attribute scanner is enough for href/src values and keeps
// this testable in Node.

export interface ExtractedLink {
  url: string
  attr: 'href' | 'src' | 'data-api-endpoint'
  text: string
}

const ATTR_RE = /<(a|img|iframe|embed|source|video|audio|link)\b([^>]*)>/gi
const VALUE_RE = /\b(href|src|data-api-endpoint)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi

export function extractLinks(html: string | null | undefined): ExtractedLink[] {
  if (!html) return []
  const out: ExtractedLink[] = []
  let tag: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((tag = ATTR_RE.exec(html))) {
    const attrs = tag[2] ?? ''
    let text = ''
    if (tag[1]!.toLowerCase() === 'a') {
      const close = html.indexOf('</a>', ATTR_RE.lastIndex)
      if (close !== -1) text = stripTags(html.slice(ATTR_RE.lastIndex, close)).slice(0, 120)
    }
    let v: RegExpExecArray | null
    VALUE_RE.lastIndex = 0
    while ((v = VALUE_RE.exec(attrs))) {
      const raw = v[3] ?? v[4] ?? v[5] ?? ''
      const url = decodeEntities(raw.trim())
      if (!url || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('data:')) continue
      out.push({ url, attr: v[1]!.toLowerCase() as ExtractedLink['attr'], text })
    }
  }
  return out
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export type LinkTarget =
  | { kind: 'course-content'; courseId: string; contentType: string; contentId: string; rest: string }
  | { kind: 'file'; courseId: string | null; fileId: string }
  | { kind: 'lti-launch'; url: string }
  | { kind: 'canvas-other'; path: string }
  | { kind: 'external'; host: string }

/** Classifies a link relative to the Canvas host the toolkit runs on. */
export function classifyLink(url: string, canvasOrigin: string): LinkTarget {
  let parsed: URL
  try {
    parsed = new URL(url, canvasOrigin)
  } catch {
    return { kind: 'external', host: '' }
  }
  const canvasHost = new URL(canvasOrigin).host
  const sameCanvas = parsed.host === canvasHost
  if (!sameCanvas) return { kind: 'external', host: parsed.host }

  let path = parsed.pathname
  // API endpoints in data-api-endpoint attributes point at the same content.
  path = path.replace(/^\/api\/v1\//, '/')

  if (/\/external_tools\/retrieve/.test(path) || /\/external_tools\/\d+/.test(path)) {
    return { kind: 'lti-launch', url: parsed.searchParams.get('url') ?? parsed.toString() }
  }

  let m = path.match(/^\/courses\/(\d+)\/files\/(\d+)/)
  if (m) return { kind: 'file', courseId: m[1]!, fileId: m[2]! }
  m = path.match(/^\/(?:users\/\d+\/)?files\/(\d+)/)
  if (m) return { kind: 'file', courseId: null, fileId: m[1]! }

  m = path.match(/^\/courses\/(\d+)\/(pages|wiki|assignments|quizzes|discussion_topics|announcements|modules|module_item_redirect)\/([^/?#]+)(.*)$/)
  if (m) {
    return {
      kind: 'course-content',
      courseId: m[1]!,
      contentType: m[2] === 'wiki' ? 'pages' : m[2]!,
      contentId: decodeURIComponent(m[3]!),
      rest: m[4] ?? '',
    }
  }
  m = path.match(/^\/courses\/(\d+)(\/.*)?$/)
  if (m) return { kind: 'course-content', courseId: m[1]!, contentType: 'course', contentId: m[1]!, rest: m[2] ?? '' }

  return { kind: 'canvas-other', path }
}

/** Third-party integrations that break or need attention after a course copy. */
export interface ToolMatch {
  vendor: 'Google' | 'Microsoft' | 'Kaltura' | 'Studio' | 'YouTube' | 'Other LTI'
  severity: 'error' | 'warning' | 'info'
  advice: string
}

const TOOL_RULES: { test: RegExp; match: ToolMatch }[] = [
  {
    test: /google\.com|googleusercontent|gsuite|assignments\.google/i,
    match: {
      vendor: 'Google',
      severity: 'error',
      advice:
        'Google Assignments (LTI 1.3) items copied from another course stay attached to the original file. Open the item, choose the file again from Drive and re-save it.',
    },
  },
  {
    test: /office365|onedrive|sharepoint|microsoft|officeapps|o365/i,
    match: {
      vendor: 'Microsoft',
      severity: 'error',
      advice:
        'Microsoft OneDrive / Office 365 items must be re-selected after a copy. The legacy Office 365 LTI 1.1 tool stops working on 2027-05-17, so replace it with the Microsoft 365 LTI.',
    },
  },
  {
    test: /kaltura|mediaspace/i,
    match: { vendor: 'Kaltura', severity: 'warning', advice: 'Kaltura media embeds need the media to be shared to the new course (Kaltura Media Gallery or co-publishing).' },
  },
  {
    test: /arc\.instructure|studio\.instructure|instructuremedia/i,
    match: { vendor: 'Studio', severity: 'info', advice: 'Canvas Studio embeds usually copy cleanly; check that captions and quizzes in the media survived.' },
  },
  { test: /youtube\.com|youtu\.be/i, match: { vendor: 'YouTube', severity: 'info', advice: 'External video: confirm it is still public.' } },
]

export function matchTool(url: string): ToolMatch | null {
  for (const rule of TOOL_RULES) if (rule.test.test(url)) return rule.match
  return null
}

/** Rewrites every occurrence of an old course link in HTML to a new path. */
export function rewriteLink(html: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match absolute and relative forms, and stop at the end of the path segment.
  const re = new RegExp(`(https?://[^"'\\s/]+)?${escaped}(?=["'?#/\\s]|$)`, 'g')
  return html.replace(re, to)
}
