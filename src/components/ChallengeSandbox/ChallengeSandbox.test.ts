import { describe, expect, it } from 'vitest';

describe('Monaco theme selection', () => {
  function getMonacoTheme(colorMode: string | undefined): string {
    return colorMode === 'night' || colorMode === 'dark' ? 'vs-dark' : 'vs';
  }

  it('uses vs-dark for night mode', () => {
    expect(getMonacoTheme('night')).toBe('vs-dark');
  });

  it('uses vs-dark for dark mode (defensive)', () => {
    expect(getMonacoTheme('dark')).toBe('vs-dark');
  });

  it('uses vs for day mode', () => {
    expect(getMonacoTheme('day')).toBe('vs');
  });

  it('uses vs for undefined (default to light)', () => {
    expect(getMonacoTheme(undefined)).toBe('vs');
  });

  it('uses vs for any other value', () => {
    expect(getMonacoTheme('auto')).toBe('vs');
  });
});
