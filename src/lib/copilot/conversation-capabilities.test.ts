/**
 * Focused unit coverage for the per-conversation capability memory.
 *
 * The end-to-end allowlist behaviour is exercised via `resolveProfile`
 * in `profiles.test.ts`; this suite locks down the cache primitives
 * (union monotonicity, user/conversation partitioning, TTL eviction,
 * and LRU pruning) so future cache-constant changes have a contract
 * test catching regressions before they reach the session pool.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getConversationCapabilities,
  rememberConversationCapabilities,
} from './conversation-capabilities';

const ONE_MINUTE_MS = 60 * 1000;

// Reset the module-global cache between tests by reaching through the
// well-known global handle the production module installs.
function clearConversationCapsCache(): void {
  const g = globalThis as { __chatConversationCapsCache?: Map<string, unknown> };
  g.__chatConversationCapsCache?.clear();
}

describe('conversation-capabilities cache', () => {
  beforeEach(() => {
    clearConversationCapsCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns [] for an unrecorded conversation', () => {
    expect(getConversationCapabilities('user-1', 'conv-1')).toEqual([]);
  });

  it('returns [] when conversationId is undefined', () => {
    expect(getConversationCapabilities('user-1', undefined)).toEqual([]);
  });

  it('records and reads back a capability set', () => {
    rememberConversationCapabilities('user-1', 'conv-1', ['github']);
    expect(getConversationCapabilities('user-1', 'conv-1')).toEqual(['github']);
  });

  it('unions monotonically across calls (never shrinks)', () => {
    rememberConversationCapabilities('user-1', 'conv-1', ['github']);
    rememberConversationCapabilities('user-1', 'conv-1', []);
    expect(getConversationCapabilities('user-1', 'conv-1')).toEqual(['github']);
  });

  it('partitions by userId so two users never share a conversation entry', () => {
    rememberConversationCapabilities('user-a', 'conv-1', ['github']);
    expect(getConversationCapabilities('user-b', 'conv-1')).toEqual([]);
  });

  it('partitions by conversationId within the same user', () => {
    rememberConversationCapabilities('user-1', 'conv-a', ['github']);
    expect(getConversationCapabilities('user-1', 'conv-b')).toEqual([]);
  });

  it('evicts entries past the 30-minute TTL on the next write', () => {
    rememberConversationCapabilities('user-1', 'conv-old', ['github']);
    // Advance past TTL (30m) by enough that pruning will sweep on the
    // next write. The TTL constant is private; 31 minutes is comfortably
    // beyond it.
    vi.advanceTimersByTime(31 * ONE_MINUTE_MS);
    rememberConversationCapabilities('user-1', 'conv-new', ['github']);
    expect(getConversationCapabilities('user-1', 'conv-old')).toEqual([]);
    expect(getConversationCapabilities('user-1', 'conv-new')).toEqual(['github']);
  });

  it('LRU-evicts the oldest entry when capacity is exceeded', () => {
    // Cache cap is 200; insert 201 distinct conversations with a 1ms
    // gap between each so lastUsed is strictly increasing. The first
    // entry should be the one pruned.
    for (let i = 0; i < 201; i += 1) {
      vi.advanceTimersByTime(1);
      rememberConversationCapabilities('user-1', `conv-${i}`, ['github']);
    }
    expect(getConversationCapabilities('user-1', 'conv-0')).toEqual([]);
    expect(getConversationCapabilities('user-1', 'conv-200')).toEqual(['github']);
  });
});
