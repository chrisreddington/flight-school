/**
 * Client-side cursor store for SSE job streams.
 *
 * Keeps per-jobId sequence cursors so an EventSource that reconnects (or
 * a user that navigates away and returns) can resume from where it left
 * off without re-rendering the entire stream.
 *
 * State lives in a module-scope Map, with an optional sessionStorage
 * mirror so cursors survive a full-page reload within the same tab. The
 * persistence layer is a soft cache: a missing or corrupt entry simply
 * falls back to `0` (full replay).
 */

const STORAGE_KEY = 'flight-school.job-cursors';

type CursorMap = Record<string, number>;

let memoryCache: CursorMap | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function loadFromSessionStorage(): CursorMap {
  if (!isBrowser()) return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: CursorMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

function persistToSessionStorage(cache: CursorMap): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota/security errors are non-fatal; in-memory cache is authoritative.
  }
}

function ensureCache(): CursorMap {
  if (memoryCache === null) memoryCache = loadFromSessionStorage();
  return memoryCache;
}

export function getCursor(jobId: string): number {
  return ensureCache()[jobId] ?? 0;
}

export function setCursor(jobId: string, seq: number): void {
  if (!Number.isFinite(seq) || seq < 0) return;
  const cache = ensureCache();
  if ((cache[jobId] ?? 0) >= seq) return;
  cache[jobId] = seq;
  persistToSessionStorage(cache);
}

export function evictCursor(jobId: string): void {
  const cache = ensureCache();
  if (!(jobId in cache)) return;
  delete cache[jobId];
  persistToSessionStorage(cache);
}

export function __resetCursorStoreForTests(): void {
  memoryCache = null;
  if (isBrowser()) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
