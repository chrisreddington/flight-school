/**
 * Tests for Workspace Export Helpers.
 */

import { describe, it, expect } from 'vitest';
import { buildWorkspaceExportFiles } from './workspace-export';

describe('buildWorkspaceExportFiles', () => {
  it('should include user files in output', () => {
    const files = buildWorkspaceExportFiles({
      challenge: {
        title: 'Test Challenge',
        description: 'A test challenge',
        difficulty: 'beginner',
      },
      files: [
        { name: 'solution.ts', content: 'const answer = 42;' },
        { name: 'test.ts', content: 'expect(answer).toBe(42);' },
      ],
    });

    const solutionFile = files.find(f => f.path === 'solution.ts');
    const testFile = files.find(f => f.path === 'test.ts');

    expect(solutionFile).toBeDefined();
    expect(solutionFile?.content).toBe('const answer = 42;');
    expect(testFile).toBeDefined();
    expect(testFile?.content).toBe('expect(answer).toBe(42);');
  });

  it('should generate README.md with challenge metadata', () => {
    const files = buildWorkspaceExportFiles({
      challenge: {
        title: 'TypeScript Generics',
        description: 'Learn generic type patterns',
        difficulty: 'intermediate',
      },
      files: [{ name: 'index.ts', content: '' }],
    });

    const readme = files.find(f => f.path === 'README.md');

    expect(readme).toBeDefined();
    expect(readme?.content).toContain('TypeScript Generics');
    expect(readme?.content).toContain('intermediate');
  });

  it('should include evaluation in README when provided', () => {
    const files = buildWorkspaceExportFiles({
      challenge: {
        title: 'Test',
        description: 'Test',
        difficulty: 'beginner',
      },
      files: [{ name: 'index.ts', content: '' }],
      evaluation: 'Great work! Your solution is correct.',
    });

    const readme = files.find(f => f.path === 'README.md');

    expect(readme?.content).toContain('Great work! Your solution is correct.');
  });

  it('should generate HINTS.md when hints are provided', () => {
    const files = buildWorkspaceExportFiles({
      challenge: {
        title: 'Test',
        description: 'Test',
        difficulty: 'beginner',
      },
      files: [{ name: 'index.ts', content: '' }],
      hints: ['Try using a loop', 'Consider edge cases'],
    });

    const hints = files.find(f => f.path === 'HINTS.md');

    expect(hints).toBeDefined();
    expect(hints?.content).toContain('Try using a loop');
    expect(hints?.content).toContain('Consider edge cases');
  });

  it('should not include HINTS.md when hints array is empty', () => {
    const files = buildWorkspaceExportFiles({
      challenge: {
        title: 'Test',
        description: 'Test',
        difficulty: 'beginner',
      },
      files: [{ name: 'index.ts', content: '' }],
      hints: [],
    });

    const hints = files.find(f => f.path === 'HINTS.md');

    expect(hints).toBeUndefined();
  });

  it('should not include HINTS.md when hints not provided', () => {
    const files = buildWorkspaceExportFiles({
      challenge: {
        title: 'Test',
        description: 'Test',
        difficulty: 'beginner',
      },
      files: [{ name: 'index.ts', content: '' }],
    });

    const hints = files.find(f => f.path === 'HINTS.md');

    expect(hints).toBeUndefined();
  });

  it('should preserve file order with README last', () => {
    const files = buildWorkspaceExportFiles({
      challenge: {
        title: 'Test',
        description: 'Test',
        difficulty: 'beginner',
      },
      files: [
        { name: 'a.ts', content: '' },
        { name: 'b.ts', content: '' },
      ],
    });

    // User files come first, then README
    expect(files[0].path).toBe('a.ts');
    expect(files[1].path).toBe('b.ts');
    expect(files[2].path).toBe('README.md');
  });
});
