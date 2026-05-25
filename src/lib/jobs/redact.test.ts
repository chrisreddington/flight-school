/**
 * Tests for the job DTO mappers in {@link ./redact}.
 *
 * The mappers exist so HTTP responses never leak the full prompt /
 * full result text or nested user-supplied code blobs (broken code,
 * file contents). The storage record is untouched — these tests
 * assert that contract.
 */

import { describe, expect, it } from 'vitest';

import type { BackgroundJob } from './storage';
import { redactJobForDetail, redactJobForList } from './redact';

function mkJob(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job-1',
    type: 'chat-response',
    userId: 'u-1',
    status: 'completed',
    input: { prompt: 'hello world' },
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('redactJobForList', () => {
  it('drops input, result, currentStep', () => {
    const dto = redactJobForList(
      mkJob({
        input: { prompt: 'secret prompt' },
        result: { text: 'secret response' },
        currentStep: 'Running tests…',
      }),
    );

    expect(dto).not.toHaveProperty('input');
    expect(dto).not.toHaveProperty('result');
    expect(dto).not.toHaveProperty('currentStep');
    expect(dto.id).toBe('job-1');
    expect(dto.type).toBe('chat-response');
    expect(dto.status).toBe('completed');
  });

  it('truncates long error strings', () => {
    const dto = redactJobForList(mkJob({ error: 'x'.repeat(2000) }));
    expect(dto.error).toBeDefined();
    expect(dto.error!.length).toBeLessThan(1000);
  });

  it('surfaces assistantMessageId from chat-response input', () => {
    const dto = redactJobForList(
      mkJob({ type: 'chat-response', input: { assistantMessageId: 'asst-42', prompt: 'p' } }),
    );
    expect(dto.assistantMessageId).toBe('asst-42');
  });

  it('does not surface assistantMessageId for non-chat-response job types', () => {
    const dto = redactJobForList(mkJob({ type: 'topic-regeneration', input: { assistantMessageId: 'asst-42' } }));
    expect(dto.assistantMessageId).toBeUndefined();
  });

  it('omits assistantMessageId when not present in input', () => {
    const dto = redactJobForList(mkJob({ type: 'chat-response', input: { prompt: 'p' } }));
    expect(dto.assistantMessageId).toBeUndefined();
  });
});

describe('redactJobForDetail', () => {
  it('caps long input strings but preserves shape', () => {
    const longPrompt = 'a'.repeat(10_000);
    const dto = redactJobForDetail(mkJob({ input: { prompt: longPrompt, otherField: 'short' } }));

    const input = dto.input as { prompt: string; otherField: string };
    expect(input.prompt.length).toBeLessThan(longPrompt.length);
    expect(input.prompt).toMatch(/truncated/);
    expect(input.otherField).toBe('short');
  });

  it('redacts nested brokenCode and files[].content', () => {
    const dto = redactJobForDetail(
      mkJob({
        input: {
          challenge: { brokenCode: 'def foo(): pass' },
          files: [{ name: 'x.py', content: 'real source code' }],
        },
      }),
    );

    const input = dto.input as {
      challenge: { brokenCode: string };
      files: Array<{ name: string; content: string }>;
    };
    expect(input.challenge.brokenCode).toBe('[redacted]');
    expect(input.files[0].content).toBe('[redacted]');
    expect(input.files[0].name).toBe('x.py');
  });

  it('does not mutate the input job record', () => {
    const job = mkJob({ input: { prompt: 'a'.repeat(10_000) } });
    const originalPrompt = (job.input as { prompt: string }).prompt;
    redactJobForDetail(job);
    expect((job.input as { prompt: string }).prompt).toBe(originalPrompt);
  });
});
