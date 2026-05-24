/**
 * Tests for the chat profile registry, resolution, composition, and
 * fingerprinting. Table-driven where the shape of the assertion repeats.
 *
 * Post-collapse: `chat-github` / `learning-github` no longer exist; the
 * caller supplies a base profile plus an explicit or `'auto'`
 * capabilities argument.
 */

import { describe, expect, it } from 'vitest';

import { CAPABILITIES, type CapabilitySelection } from './capabilities';
import {
  InvalidCapabilityError,
  PROFILES,
  capabilityFingerprintOf,
  composeSystemMessage,
  resolveProfile,
  type BaseProfileId,
} from './profiles';

describe('PROFILES registry', () => {
  it.each(Object.keys(PROFILES) as BaseProfileId[])(
    'profile %s declares an id matching its key and a model',
    (id) => {
      const profile = PROFILES[id];
      expect(profile.id).toBe(id);
      expect(profile.model.length).toBeGreaterThan(0);
    },
  );

  it('declares non-empty autoCapabilities only for chat and learning', () => {
    expect(PROFILES.chat.autoCapabilities).toEqual(['github']);
    expect(PROFILES.learning.autoCapabilities).toEqual(['github']);
    for (const id of ['coach', 'evaluation', 'authoring'] as BaseProfileId[]) {
      expect(PROFILES[id].autoCapabilities).toEqual([]);
    }
  });
});

describe('resolveProfile', () => {
  it.each<{
    profile: BaseProfileId;
    prompt?: string;
    auto?: boolean;
    expectedCapabilityIds: string[];
    expectedElevated: boolean;
  }>([
    { profile: 'chat', prompt: 'hello', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'chat', prompt: 'list my repos', auto: true, expectedCapabilityIds: ['github'], expectedElevated: true },
    { profile: 'learning', prompt: 'explain closures', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'learning', prompt: 'what is in my repo', auto: true, expectedCapabilityIds: ['github'], expectedElevated: true },
    // Coach is lightweight by default — capability selection is orthogonal,
    // callers opt in to MCP grounding with capabilities: ['github'].
    { profile: 'coach', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'evaluation', expectedCapabilityIds: [], expectedElevated: false },
    { profile: 'authoring', expectedCapabilityIds: [], expectedElevated: false },
  ])(
    "profile=$profile prompt=$prompt → capabilities=$expectedCapabilityIds wasAutoElevated=$expectedElevated",
    ({ profile, prompt, auto, expectedCapabilityIds, expectedElevated }) => {
      const ctx = prompt === undefined && !auto
        ? undefined
        : { ...(prompt !== undefined ? { prompt } : {}), ...(auto ? { capabilities: 'auto' as const } : {}) };
      const resolved = resolveProfile(profile, ctx);
      expect(resolved.capabilities.map((cap) => cap.id)).toEqual(expectedCapabilityIds);
      expect(resolved.wasAutoElevated).toBe(expectedElevated);
    },
  );

  it("honours explicit capabilities=['github'] on chat", () => {
    const resolved = resolveProfile('chat', { capabilities: ['github'] });
    expect(resolved.capabilities.map((c) => c.id)).toEqual(['github']);
    expect(resolved.wasAutoElevated).toBe(false);
  });

  it('throws InvalidCapabilityError when an explicit capability is not in the profile allowlist', () => {
    expect(() => resolveProfile('evaluation', { capabilities: ['github'] })).toThrow(
      InvalidCapabilityError,
    );
  });

  it("rejects 'auto' that would elevate beyond allowedCapabilities by simply not elevating", () => {
    // evaluation has no autoCapabilities, so 'auto' is a no-op.
    const resolved = resolveProfile('evaluation', { capabilities: 'auto', prompt: 'list my repos' });
    expect(resolved.capabilities).toEqual([]);
  });

  it('unions conversationCapabilities monotonically across turns', () => {
    // Turn 1: explicit ['github']
    // Turn 2: no caps, but caller carries the conversation's caps
    const turn2 = resolveProfile('chat', {
      prompt: 'hello',
      conversationCapabilities: ['github'],
    });
    expect(turn2.capabilities.map((c) => c.id)).toEqual(['github']);
    // Carried-in capabilities never count as auto-elevated.
    expect(turn2.wasAutoElevated).toBe(false);
  });

  it('coach capabilityDefaults override github tools and addendum when github is selected', () => {
    const resolved = resolveProfile('coach', { capabilities: ['github'] });
    const github = resolved.capabilities.find((cap) => cap.id === 'github');
    expect(github?.tools).toEqual(['get_me', 'list_user_repositories']);
    expect(github?.promptAddendumOverride).toBeDefined();
  });

  it('coach with capabilities=["github"] and chat+github do not collide on fingerprint', () => {
    const coachWithGithub = resolveProfile('coach', { capabilities: ['github'] }).capabilityFingerprint;
    const chatGithub = resolveProfile('chat', { capabilities: ['github'] }).capabilityFingerprint;
    expect(coachWithGithub).not.toBe(chatGithub);
  });

  it('produces a stable capability fingerprint for chat+github', () => {
    const resolved = resolveProfile('chat', { capabilities: ['github'] });
    expect(resolved.capabilityFingerprint).toBe('caps=github');
  });

  it('composes the system message from base prompt + capability addenda', () => {
    const resolved = resolveProfile('chat', { capabilities: ['github'] });
    expect(resolved.systemMessage.startsWith(PROFILES.chat.basePrompt)).toBe(true);
    expect(resolved.systemMessage).toContain(CAPABILITIES.github.promptAddendum);
  });

  it('returns just the base prompt when no capabilities are active', () => {
    const resolved = resolveProfile('chat');
    expect(resolved.systemMessage).toBe(PROFILES.chat.basePrompt);
  });

  it('returns an empty string when both base prompt and capabilities are empty', () => {
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

  it('is order-independent for tool overrides', () => {
    const left = capabilityFingerprintOf([{ id: 'github', tools: ['b', 'a'] }]);
    const right = capabilityFingerprintOf([{ id: 'github', tools: ['a', 'b'] }]);
    expect(left).toBe(right);
  });

  it('encodes tool overrides so different surfaces do not collide', () => {
    expect(capabilityFingerprintOf([{ id: 'github' }])).toBe('caps=github');
    expect(capabilityFingerprintOf([{ id: 'github', tools: ['get_me'] }])).toBe(
      'caps=github@tools=get_me',
    );
  });

  it('encodes prompt addendum overrides via a short hash', () => {
    const fp = capabilityFingerprintOf([
      { id: 'github', promptAddendumOverride: 'custom coach addendum' },
    ]);
    expect(fp.startsWith('caps=github@addH=')).toBe(true);
  });
});
