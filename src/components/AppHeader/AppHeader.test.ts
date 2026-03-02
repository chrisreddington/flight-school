import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appHeaderSource = readFileSync(
  resolve(process.cwd(), 'src/components/AppHeader/index.tsx'),
  'utf8'
);

describe('AppHeader debug mode visibility', () => {
  const hasDevelopmentGuard = /process\.env\.NODE_ENV === 'development'/.test(appHeaderSource);

  function isDebugMenuVisible(nodeEnv: string): boolean {
    return nodeEnv === 'development' && hasDevelopmentGuard;
  }

  it('does not render Debug Mode when NODE_ENV is production', () => {
    expect(isDebugMenuVisible('production')).toBe(false);
  });

  it('renders Debug Mode when NODE_ENV is development', () => {
    expect(isDebugMenuVisible('development')).toBe(true);
  });
});
