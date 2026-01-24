/**
 * Tests for ID generation utilities.
 *
 * Covers ID format and uniqueness guarantees.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateId, generateMessageId, generateHintId } from './id-generator';

describe('generateId', () => {
  describe('format', () => {
    it('should follow prefix-timestamp-random format', () => {
      const id = generateId('test');
      const parts = id.split('-');

      expect(parts[0]).toBe('test');
      expect(parts[1]).toMatch(/^\d+$/); // timestamp (numeric)
      expect(parts[2]).toMatch(/^[a-z0-9]+$/); // random (base36)
    });

    it('should use default prefix when not provided', () => {
      const id = generateId();
      expect(id).toMatch(/^id-\d+-[a-z0-9]+$/);
    });

    it('should support custom prefixes', () => {
      expect(generateId('msg')).toMatch(/^msg-/);
      expect(generateId('thread')).toMatch(/^thread-/);
      expect(generateId('custom')).toMatch(/^custom-/);
    });
  });

  describe('uniqueness', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId('test'));
      }
      expect(ids.size).toBe(100);
    });

    it('should generate unique IDs even with same timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-23T00:00:00.000Z'));

      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(generateId('test'));
      }

      vi.useRealTimers();

      // Even with same timestamp, random suffix should ensure uniqueness
      // (statistically extremely likely with base36 randomness)
      expect(ids.size).toBe(50);
    });
  });

  describe('timestamp component', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should include current timestamp', () => {
      const testTime = 1737590400000; // 2026-01-23T00:00:00.000Z
      vi.setSystemTime(testTime);

      const id = generateId('test');
      const timestamp = id.split('-')[1];

      expect(parseInt(timestamp, 10)).toBe(testTime);
    });

    it('should use different timestamps at different times', () => {
      vi.setSystemTime(1000);
      const id1 = generateId('test');

      vi.setSystemTime(2000);
      const id2 = generateId('test');

      const ts1 = id1.split('-')[1];
      const ts2 = id2.split('-')[1];

      expect(ts1).not.toBe(ts2);
    });
  });

  describe('random suffix', () => {
    it('should be 7 characters or less', () => {
      // Generate many IDs to check random suffix length
      for (let i = 0; i < 100; i++) {
        const id = generateId('test');
        const random = id.split('-')[2];
        expect(random.length).toBeLessThanOrEqual(7);
        expect(random.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('generateMessageId', () => {
  it('should use "msg" prefix', () => {
    const id = generateMessageId();
    expect(id).toMatch(/^msg-\d+-[a-z0-9]+$/);
  });

  it('should generate unique message IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateMessageId());
    }
    expect(ids.size).toBe(50);
  });
});

describe('generateHintId', () => {
  it('should use "hint" prefix', () => {
    const id = generateHintId();
    expect(id).toMatch(/^hint-\d+-[a-z0-9]+$/);
  });

  it('should generate unique hint IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateHintId());
    }
    expect(ids.size).toBe(50);
  });
});
