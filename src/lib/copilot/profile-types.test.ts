import { describe, expect, it } from 'vitest';

import {
  BASE_PROFILE_IDS,
  CHAT_RESPONSE_PROFILES,
  areCapabilitiesAllowedForProfile,
  isChatResponseProfile,
  type BaseProfileId,
} from './profile-types';

describe('isChatResponseProfile', () => {
  it.each(CHAT_RESPONSE_PROFILES)('accepts chat-response profile %s', (id) => {
    expect(isChatResponseProfile(id)).toBe(true);
  });

  it.each(
    BASE_PROFILE_IDS.filter(
      (id): id is Exclude<BaseProfileId, (typeof CHAT_RESPONSE_PROFILES)[number]> =>
        !(CHAT_RESPONSE_PROFILES as readonly string[]).includes(id),
    ),
  )('rejects non-chat-response profile %s', (id) => {
    expect(isChatResponseProfile(id)).toBe(false);
  });

  it.each<unknown>([null, undefined, 0, {}, [], 'CHAT'])(
    'rejects non-string / unknown profile values: %s',
    (value) => {
      expect(isChatResponseProfile(value)).toBe(false);
    },
  );
});

describe('areCapabilitiesAllowedForProfile', () => {
  // Direct gating coverage that the IPC parser depends on. With more
  // capabilities and profile-specific allowlists landing later, this is
  // the structural seam that prevents a misconfigured caller from
  // smuggling a disallowed capability past the worker boundary.
  it.each<{ profile: BaseProfileId; capabilities: 'auto' | undefined }>([
    { profile: 'chat', capabilities: undefined },
    { profile: 'evaluation', capabilities: undefined },
    { profile: 'chat', capabilities: 'auto' },
    { profile: 'evaluation', capabilities: 'auto' },
  ])('allows $capabilities for profile $profile', ({ profile, capabilities }) => {
    expect(areCapabilitiesAllowedForProfile(profile, capabilities)).toBe(true);
  });

  it('allows a capability the profile explicitly permits', () => {
    expect(areCapabilitiesAllowedForProfile('learning', ['github'])).toBe(true);
  });

  it.each<BaseProfileId>(['evaluation', 'authoring'])(
    'rejects github capability for profile %s (allowlist empty)',
    (profile) => {
      expect(areCapabilitiesAllowedForProfile(profile, ['github'])).toBe(false);
    },
  );
});
