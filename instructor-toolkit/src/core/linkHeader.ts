/** Returns the rel="next" URL from a Canvas pagination Link header, if any. */
export function nextPageUrl(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/)
    if (match && match[2] === 'next') return match[1] ?? null
  }
  return null
}
