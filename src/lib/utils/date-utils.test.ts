/**
 * Tests for date/time utilities.
 *
 * Covers date formatting and key generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { now, nowMs, getDateKey, formatTimestamp } from './date-utils';

describe('now', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return ISO 8601 formatted string', () => {
    vi.setSystemTime(new Date('2026-01-23T10:30:00.000Z'));
    expect(now()).toBe('2026-01-23T10:30:00.000Z');
  });

  it('should include milliseconds', () => {
    vi.setSystemTime(new Date('2026-01-23T10:30:00.123Z'));
    expect(now()).toBe('2026-01-23T10:30:00.123Z');
  });
});

describe('nowMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return milliseconds since epoch', () => {
    const testDate = new Date('2026-01-23T10:30:00.000Z');
    vi.setSystemTime(testDate);
    expect(nowMs()).toBe(testDate.getTime());
  });

  it('should return number type', () => {
    expect(typeof nowMs()).toBe('number');
  });
});

describe('getDateKey', () => {
  it('should format as YYYY-MM-DD', () => {
    const date = new Date('2026-01-23T10:30:00.000Z');
    // Note: getDateKey uses local timezone, so we need to account for that
    const key = getDateKey(date);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should pad single-digit months and days', () => {
    const date = new Date(2026, 0, 5); // January 5, 2026 (local time)
    expect(getDateKey(date)).toBe('2026-01-05');
  });

  it('should handle December correctly', () => {
    const date = new Date(2026, 11, 25); // December 25, 2026 (local time)
    expect(getDateKey(date)).toBe('2026-12-25');
  });

  it('should use current date when no argument provided', () => {
    const key = getDateKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each([
    { year: 2026, month: 0, day: 1, expected: '2026-01-01' },
    { year: 2026, month: 5, day: 15, expected: '2026-06-15' },
    { year: 2026, month: 11, day: 31, expected: '2026-12-31' },
  ])(
    'should format $year-$month-$day as $expected',
    ({ year, month, day, expected }) => {
      const date = new Date(year, month, day);
      expect(getDateKey(date)).toBe(expected);
    }
  );
});

describe('formatTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set "now" to January 23, 2026, noon local time
    vi.setSystemTime(new Date(2026, 0, 23, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('today formatting', () => {
    it('should show "today at" for same-day timestamps', () => {
      // Create a timestamp for today at 10:30 AM local time
      const today = new Date(2026, 0, 23, 10, 30, 0);
      const result = formatTimestamp(today.toISOString());

      expect(result).toMatch(/^today at \d{1,2}:\d{2} [AP]M$/i);
    });
  });

  describe('yesterday formatting', () => {
    it('should show "yesterday at" for previous day', () => {
      // Create a timestamp for yesterday at 3:45 PM local time
      const yesterday = new Date(2026, 0, 22, 15, 45, 0);
      const result = formatTimestamp(yesterday.toISOString());

      expect(result).toMatch(/^yesterday at \d{1,2}:\d{2} [AP]M$/i);
    });
  });

  describe('older dates formatting', () => {
    it('should show date and time for dates before yesterday', () => {
      // Create a timestamp for January 20, 2026 at 9:15 AM local time
      const older = new Date(2026, 0, 20, 9, 15, 0);
      const result = formatTimestamp(older.toISOString());

      // Should be "Jan 20 at 9:15 AM" format
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2} at \d{1,2}:\d{2} [AP]M$/i);
    });

    it('should handle dates from previous month', () => {
      const lastMonth = new Date(2025, 11, 15, 14, 0, 0); // Dec 15, 2025
      const result = formatTimestamp(lastMonth.toISOString());

      expect(result).toMatch(/^Dec 15 at \d{1,2}:\d{2} [AP]M$/i);
    });
  });

  describe('time formatting', () => {
    it('should use 12-hour format with AM/PM', () => {
      const morning = new Date(2026, 0, 23, 9, 30, 0);
      const evening = new Date(2026, 0, 23, 21, 30, 0);

      expect(formatTimestamp(morning.toISOString())).toMatch(/AM$/i);
      expect(formatTimestamp(evening.toISOString())).toMatch(/PM$/i);
    });

    it('should handle midnight', () => {
      const midnight = new Date(2026, 0, 23, 0, 0, 0);
      const result = formatTimestamp(midnight.toISOString());

      expect(result).toMatch(/12:00 AM/i);
    });

    it('should handle noon', () => {
      const noon = new Date(2026, 0, 23, 12, 0, 0);
      const result = formatTimestamp(noon.toISOString());

      expect(result).toMatch(/12:00 PM/i);
    });
  });
});
