import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const habitsStylesSource = readFileSync(
  resolve(process.cwd(), 'src/app/habits/habits.module.css'),
  'utf8'
);

describe('habits progress bar styles', () => {
  it('uses bgColor-muted for progress bar track', () => {
    expect(habitsStylesSource).toMatch(
      /\.progressBar\s*\{[\s\S]*background-color:\s*var\(--bgColor-muted,\s*#f6f8fa\);/
    );
  });

  it('keeps bgColor-success-emphasis for progress fill', () => {
    expect(habitsStylesSource).toMatch(
      /\.progressFill\s*\{[\s\S]*background-color:\s*var\(--bgColor-success-emphasis,\s*#1a7f37\);/
    );
  });
});
