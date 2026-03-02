import { describe, expect, it } from 'vitest';

describe('stripJsonFromChatContent logic', () => {
  function stripJsonFromChatContent(content: string): string {
    let stripped = content.replace(/```json[\s\S]*?```/g, '');
    stripped = stripped.replace(/```[\s\S]*?```/g, (match) => {
      const inner = match.slice(3, -3).trim();
      return inner.startsWith('{') || inner.startsWith('[') ? '' : match;
    });
    return stripped.replace(/\n{3,}/g, '\n\n').trim();
  }

  it('removes ```json blocks', () => {
    const content = 'Great challenge!\n\n```json\n{"title": "Test"}\n```\n\nClick create.';
    expect(stripJsonFromChatContent(content)).toBe('Great challenge!\n\nClick create.');
  });

  it('removes generic code blocks containing JSON', () => {
    const content = 'Here it is:\n\n```\n{"title": "Test"}\n```\n\nDone.';
    expect(stripJsonFromChatContent(content)).toBe('Here it is:\n\nDone.');
  });

  it('keeps non-JSON code blocks intact', () => {
    const content = 'Example:\n\n```typescript\nconst x = 1;\n```\n\nAbove is code.';
    expect(stripJsonFromChatContent(content)).toContain('```typescript');
  });

  it('returns empty string for content that is only JSON', () => {
    const content = '```json\n{"title": "Test"}\n```';
    expect(stripJsonFromChatContent(content)).toBe('');
  });

  it('handles content with no JSON blocks unchanged', () => {
    const content = 'Sure, here is your challenge description.';
    expect(stripJsonFromChatContent(content)).toBe(content);
  });
});
