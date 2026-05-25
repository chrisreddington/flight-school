import { describe, expect, it } from 'vitest';

import { parseRegenerationResponse } from './parse-regeneration';

describe('parseRegenerationResponse', () => {
  it.each([
    {
      scenario: 'plain JSON object',
      response: '{"challenge":{"id":"c1","title":"Refactor X"}}',
      expected: { id: 'c1', title: 'Refactor X' },
    },
    {
      scenario: 'fenced ```json code block',
      response: '```json\n{"challenge":{"id":"c2","title":"Add tests"}}\n```',
      expected: { id: 'c2', title: 'Add tests' },
    },
    {
      scenario: 'JSON embedded in surrounding prose',
      response: 'Here you go:\n{"challenge":{"id":"c3","title":"Bug hunt"}}\nHope that helps!',
      expected: { id: 'c3', title: 'Bug hunt' },
    },
  ])('returns the nested entity for $scenario', ({ response, expected }) => {
    const parsed = parseRegenerationResponse<{ challenge: typeof expected }, typeof expected>(
      response,
      'challenge',
      'challenge',
    );
    expect(parsed).toEqual(expected);
  });

  it.each([
    {
      scenario: 'unparseable prose response',
      response: 'sorry, I cannot help with that today.',
      previewIncludes: 'sorry, I cannot help',
    },
    {
      scenario: 'JSON with the wrong wrapper key',
      response: '{"challenges":[{"id":"c1"}]}',
      previewIncludes: '"challenges"',
    },
    {
      scenario: 'empty response',
      response: '',
      previewIncludes: '(preview: )',
    },
  ])('throws with the response preview when $scenario', ({ response, previewIncludes }) => {
    expect(() =>
      parseRegenerationResponse<{ challenge: unknown }, unknown>(response, 'challenge', 'challenge'),
    ).toThrow(previewIncludes);
  });

  it('truncates very long responses in the preview to keep logs readable', () => {
    const longResponse = 'x'.repeat(2000);
    let caught: Error | null = null;
    try {
      parseRegenerationResponse<{ goal: unknown }, unknown>(longResponse, 'goal', 'goal');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('…');
    // 400-char preview + framing characters; nowhere near the 2000-char original.
    expect(caught!.message.length).toBeLessThan(600);
  });
});
