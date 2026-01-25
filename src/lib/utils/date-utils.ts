/**
 * Date/Time Utilities
 * 
 * Centralized date and time utilities to ensure consistent formatting
 * and reduce duplication across the codebase.
 */

/**
 * Get current timestamp as ISO string.
 * 
 * @returns ISO 8601 formatted timestamp
 * 
 * @example
 * ```typescript
 * const createdAt = now();
 * // "2026-01-23T10:30:00.000Z"
 * ```
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Get current timestamp in milliseconds.
 * 
 * @returns Milliseconds since Unix epoch
 * 
 * @example
 * ```typescript
 * const startTime = nowMs();
 * // 1737625800000
 * ```
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Get a date key for daily cache buckets (YYYY-MM-DD) in local timezone.
 *
 * @param date - Date to format (default: now)
 * @returns Date key string
 *
 * @example
 * ```typescript
 * const key = getDateKey();
 * // "2026-01-23"
 * ```
 */
export function getDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a timestamp for display.
 *
 * @param isoTimestamp - ISO timestamp string
 * @returns Human-readable timestamp label
 */
export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const dateKey = getDateKey(date);
  const todayKey = getDateKey(today);
  const yesterdayKey = getDateKey(yesterday);

  if (dateKey === todayKey) {
    return `today at ${timeStr}`;
  }

  if (dateKey === yesterdayKey) {
    return `yesterday at ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${dateStr} at ${timeStr}`;
}

/**
 * Check whether a date key is today.
 *
 * @param dateKey - Date key in YYYY-MM-DD format
 * @returns True if the date key matches today in local time
 */
export function isTodayDateKey(dateKey: string): boolean {
  return dateKey === getDateKey();
}
