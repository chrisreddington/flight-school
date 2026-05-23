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
