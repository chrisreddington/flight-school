import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appHeaderSource = readFileSync(resolve(process.cwd(), 'src/components/AppHeader/index.tsx'), 'utf8');

describe('AppHeader debug mode consolidation', () => {
  it('does not expose a Debug Mode toggle in the header menu (it now lives in Settings)', () => {
    expect(appHeaderSource).not.toMatch(/Debug Mode/);
    expect(appHeaderSource).not.toMatch(/toggleDebugMode/);
  });

  it('links the username menu item to the user GitHub profile', () => {
    expect(appHeaderSource).toMatch(/github\.com\/\$\{username\}/);
  });
});
