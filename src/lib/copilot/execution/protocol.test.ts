import { describe, expect, it } from 'vitest';
import { parseCopilotWorkerChatRequest, parseCopilotWorkerChatResult } from './protocol';

describe('parseCopilotWorkerChatRequest', () => {
  it('accepts valid chat execution requests', () => {
    const request = parseCopilotWorkerChatRequest({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      profile: 'chat',
      conversationId: 'thread-1',
    });

    expect(request).toEqual({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      profile: 'chat',
      conversationId: 'thread-1',
    });
  });

  it('rejects missing identity token', () => {
    expect(() =>
      parseCopilotWorkerChatRequest({
        identity: { userId: '123' },
        prompt: 'hello',
        profile: 'chat',
      }),
    ).toThrow('identity.gitHubToken is required');
  });

  it('rejects non-chat-response profile values', () => {
    expect(() =>
      parseCopilotWorkerChatRequest({
        identity: { userId: '123', gitHubToken: 'ghu_user' },
        prompt: 'hello',
        profile: 'coach',
      }),
    ).toThrow('profile must be a chat-response profile');
  });

  it('rejects unrecognised capability ids', () => {
    // Sanity guard: malformed capabilities arg trips `isCapabilitiesArg`
    // before profile/capability gating. The dedicated allowlist gate is
    // covered by profile-types.test.ts (areCapabilitiesAllowedForProfile).
    expect(() =>
      parseCopilotWorkerChatRequest({
        identity: { userId: '123', gitHubToken: 'ghu_user' },
        prompt: 'hello',
        profile: 'chat',
        capabilities: ['not-a-real-capability'],
      }),
    ).toThrow("capabilities must be 'auto' or an array of valid capability ids");
  });
});

describe('parseCopilotWorkerChatResult', () => {
  it('accepts valid chat execution results', () => {
    expect(
      parseCopilotWorkerChatResult({
        response: 'answer',
        toolCalls: [],
        meta: {
          generatedAt: '2026-05-22T18:00:00.000Z',
          model: 'claude-haiku-4.5',
          toolsUsed: [],
          totalTimeMs: 10,
          profile: 'chat',
          sessionCreateMs: null,
          sessionPoolHit: null,
          mcpEnabled: null,
          sessionReused: null,
        },
      }).response,
    ).toBe('answer');
  });

  it('rejects missing result metadata', () => {
    expect(() => parseCopilotWorkerChatResult({ response: 'answer', toolCalls: [] })).toThrow('meta is required');
  });
});
