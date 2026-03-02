import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const quickTemplatesSource = readFileSync(
  resolve(process.cwd(), 'src/components/ChallengeAuthoring/quick-templates.tsx'),
  'utf8'
);

describe('quick templates names', () => {
  it('does not include emoji characters in template names', () => {
    const templateNameMatches = [...quickTemplatesSource.matchAll(/name:\s*'([^']+)'/g)];
    const templateNames = templateNameMatches.map((match) => match[1]);
    const emojiRegex = /\p{Extended_Pictographic}/u;

    expect(templateNames.some((name) => emojiRegex.test(name))).toBe(false);
  });

  it('uses Debug Challenge as the debug template name', () => {
    expect(quickTemplatesSource).toMatch(
      /id:\s*'debug'[\s\S]*?name:\s*'Debug Challenge'/
    );
  });
});
