import { describe, expect, it } from 'vitest';
import { createNewSessionMetrics, createReusedSessionMetrics } from './session-metrics';

describe('Copilot session metrics helpers', () => {
  it('should create metrics for a newly created SDK session', () => {
    expect(
      createNewSessionMetrics({
        poolKey: 'chat:mcp',
        sessionCreateMs: 123,
        mcpEnabled: true,
        model: 'gpt-5-mini',
      }),
    ).toEqual({
      poolKey: 'chat:mcp',
      createdNew: true,
      sessionCreateMs: 123,
      mcpEnabled: true,
      model: 'gpt-5-mini',
      reusedConversation: false,
    });
  });

  it('should derive metrics for a reused conversation session', () => {
    expect(
      createReusedSessionMetrics({
        poolKey: 'chat:mcp',
        createdNew: true,
        sessionCreateMs: 123,
        mcpEnabled: true,
        model: 'gpt-5-mini',
        reusedConversation: false,
      }),
    ).toEqual({
      poolKey: 'chat:mcp',
      createdNew: false,
      sessionCreateMs: 0,
      mcpEnabled: true,
      model: 'gpt-5-mini',
      reusedConversation: true,
    });
  });
});
