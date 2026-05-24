import { describe, expect, it } from 'vitest';

import {
  BASE_PROFILE_IDS,
  CHAT_RESPONSE_PROFILES,
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
