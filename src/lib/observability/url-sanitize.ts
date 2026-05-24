/**
 * Removes the query string and fragment from a URL. Used to keep
 * potentially-sensitive parameters (tokens, ids, search terms) out of
 * span attributes before they are exported.
 *
 * Returns the input unchanged if it cannot be parsed — best-effort.
 */
export function stripQueryString(url: string): string {
  if (!url) return url;
  const isRelative = url.startsWith('/');
  try {
    const parsed = new URL(url, isRelative ? 'http://_local' : undefined);
    parsed.search = '';
    parsed.hash = '';
    if (isRelative) {
      return `${parsed.pathname}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Returns just the pathname portion of a URL (e.g. `/api/foo`). Falls back
 * to the input when parsing fails. Used to produce compact, scannable span
 * names like `GET /api/foo` instead of full origin-prefixed URLs.
 */
export function extractPathname(url: string): string {
  if (!url) return url;
  if (url.startsWith('/')) return url;
  try {
    const parsed = new URL(url);
    return parsed.pathname || url;
  } catch {
    return url;
  }
}
