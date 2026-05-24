/**
 * Tests for the chat profile registry, resolution, composition, and
 * fingerprinting. Table-driven where the shape of the assertion repeats.
 */

import { describe, expect, it } from 'vitest';

import { CAPABILITIES, type CapabilitySelection } from './capabilities';
import {
  PROFILES,
  capabilityFingerprintOf,
  composeSystemMessage,
  resolveProfile,
  type ChatProfileId,
} from './profiles';

describe('PROFILES registry', () => {
  it.each(Object.keys(PROFILES) as ChatProfileId[])(
    'profile %s declares an id matching its key and a model',
    (id) => {
      const profile = PROFILES[id];
      expect(profile.id).toBe(id);
      expect(profile.model.length).toBeGreaterThan(0);
    },
  );

  it('only profiles flagged for elevation can auto-attach capabilities', () => {
    expect(PROFILES.chat.allowElevation).toBe(true);
    expect(PROFILES.learning.allowElevation).toBe(true);
    for (const id of ['chat-github', 'learning-github', 'evaluation', 'coach', 'coach-lightweight', 'authoring'] as ChatProfileId[]) {
      expect(PROFILES[id].allowElevation).toBe(false);
    }
  });
});

describe('resolveProfile', () => {
  it.each<{
    profile: ChatProfileId;
    prompt?: string;
    expectedCapabilityIds: string[];
    expectedElevated: boolean;
  }>([
    { profile: 'chat', prompt: 'hello', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'chat', prompt: 'list my repos', expectedCapabilityIds: ['github'], expectedElevated: true },
    { profile: 'chat-github', expectedCapabilityIds: ['github'], expectedElevated: false },
    { profile: 'chat-github', prompt: 'list my repos', expectedCapabilityIds: ['github'], expectedElevated: false },
    { profile: 'learning', prompt: 'explain closures', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'learning', prompt: 'what is in my repo', expectedCapabilityIds: ['github'], expectedElevated: true },
    { profile: 'learning-github', expectedCapabilityIds: ['github'], expectedElevated: false },
    { profile: 'coach', expectedCapabilityIds: ['github'], expectedElevated: false },
    { profile: 'coach-lightweight', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'evaluation', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'authoring', expectedCapabilityIds: [], expectedElevated: false },
  ])(
    'profile=$profile prompt=$prompt → capabilities=$expectedCapabilityIds elevated=$expectedElevated',
    ({ profile, prompt, expectedCapabilityIds, expectedElevated }) => {
      const resolved = resolveProfile(profile, prompt === undefined ? undefined : { prompt });
      expect(resolved.capabilities.map((cap) => cap.id)).toEqual(expectedCapabilityIds);
      expect(resolved.elevated).toBe(expectedElevated);
    },
  );

  it('elevation never removes a base capability', () => {
    // chat-github already has github; an elevation pass must not strip it
    // regardless of prompt content.
    const resolved = resolveProfile('chat-github', { prompt: 'something unrelated' });
    expect(resolved.capabilities.map((cap) => cap.id)).toEqual(['github']);
  });

  it('preserves per-profile tool overrides (coach uses a github tool subset)', () => {
    const resolved = resolveProfile('coach');
    const github = resolved.capabilities.find((cap) => cap.id === 'github');
    expect(github?.tools).toEqual(['get_me', 'list_user_repositories']);
  });

  it('produces a stable, sorted capability fingerprint', () => {
    const resolved = resolveProfile('chat-github');
    expect(resolved.capabilityFingerprint).toBe('caps=github');
  });

  it('reflects tool overrides in the fingerprint so coach and chat-github do not share a cache entry', () => {
    const coach = resolveProfile('coach').capabilityFingerprint;
    const chatGithub = resolveProfile('chat-github').capabilityFingerprint;
    expect(coach).not.toBe(chatGithub);
  });

  it('composes the system message from base prompt + capability addenda', () => {
    const resolved = resolveProfile('chat-github');
    expect(resolved.systemMessage.startsWith(PROFILES['chat-github'].basePrompt)).toBe(true);
    expect(resolved.systemMessage).toContain(CAPABILITIES.github.promptAddendum);
  });

  it('returns just the base prompt when no capabilities are active', () => {
    const resolved = resolveProfile('chat');
    expect(resolved.systemMessage).toBe(PROFILES.chat.basePrompt);
  });

  it('returns just the addendum when the base prompt is empty', () => {
    // evaluation has empty base prompt and no caps, so the result is ''
    expect(resolveProfile('evaluation').systemMessage).toBe('');
  });
});

describe('composeSystemMessage', () => {
  it.each<{ name: string; base: string; caps: CapabilitySelection[]; expected: string }>([
    { name: 'empty everywhere', base: '', caps: [], expected: '' },
    { name: 'base only', base: 'voice', caps: [], expected: 'voice' },
    {
      name: 'addendum only (empty base)',
      base: '',
      caps: [{ id: 'github' }],
      expected: CAPABILITIES.github.promptAddendum,
    },
    {
      name: 'base + single addendum',
      base: 'voice',
      caps: [{ id: 'github' }],
      expected: `voice\n\n${CAPABILITIES.github.promptAddendum}`,
    },
  ])('$name', ({ base, caps, expected }) => {
    expect(composeSystemMessage(base, caps)).toBe(expected);
  });
});

describe('capabilityFingerprintOf', () => {
  it('returns caps=none for an empty selection', () => {
    expect(capabilityFingerprintOf([])).toBe('caps=none');
  });

  it('is order-independent', () => {
    // Single-capability registry today, so use synthetic tool overrides to
    // prove the sort. (Adding more capabilities later will exercise the
    // multi-id sort automatically.)
    const left = capabilityFingerprintOf([{ id: 'github', tools: ['b', 'a'] }]);
    const right = capabilityFingerprintOf([{ id: 'github', tools: ['a', 'b'] }]);
    expect(left).toBe(right);
  });

  it('encodes tool overrides so different surfaces do not collide', () => {
    expect(capabilityFingerprintOf([{ id: 'github' }])).toBe('caps=github');
    expect(capabilityFingerprintOf([{ id: 'github', tools: ['get_me'] }])).toBe('caps=github@get_me');
  });
});
