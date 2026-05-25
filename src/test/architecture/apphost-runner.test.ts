import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>;
};

describe('AppHost runner dependencies', () => {
  it('installs tsx locally because Aspire runs the TypeScript AppHost through npm exec', () => {
    expect(packageJson.devDependencies?.tsx).toBeDefined();
  });
});
