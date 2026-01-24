/**
 * Tests for Profile Context Builder utilities.
 */

import { describe, it, expect } from 'vitest';
import { serializeContext } from './profile';
import type { CompactDeveloperProfile } from './types';

describe('serializeContext', () => {
  it('should serialize a minimal profile', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [],
      t: [],
      a: { c: 0, pr: 0, d: 7, r: [] },
      g: [],
      rd: [],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    expect(result).toContain('u:testuser');
    expect(result).toContain('a:0:0:7:');
    expect(result).toContain('cp:conventional');
  });

  it('should serialize language proficiencies', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [
        { n: 'TypeScript', b: 50000, p: 60 },
        { n: 'JavaScript', b: 20000, p: 24 },
      ],
      t: [],
      a: { c: 0, pr: 0, d: 7, r: [] },
      g: [],
      rd: [],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    expect(result).toContain('lp:TypeScript:50000:60,JavaScript:20000:24');
  });

  it('should serialize topics', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [],
      t: ['react', 'typescript', 'api'],
      a: { c: 0, pr: 0, d: 7, r: [] },
      g: [],
      rd: [],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    expect(result).toContain('t:react,typescript,api');
  });

  it('should serialize activity summary', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [],
      t: [],
      a: { c: 15, pr: 3, d: 7, r: ['my-app', 'utils'] },
      g: [],
      rd: [],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    expect(result).toContain('a:15:3:7:my-app,utils');
  });

  it('should serialize skill gaps', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [],
      t: [],
      a: { c: 0, pr: 0, d: 7, r: [] },
      g: ['testing', 'ci', 'documentation'],
      rd: [],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    expect(result).toContain('g:testing,ci,documentation');
  });

  it('should serialize README keywords', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [],
      t: [],
      a: { c: 0, pr: 0, d: 7, r: [] },
      g: [],
      rd: ['frontend', 'backend', 'fullstack'],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    expect(result).toContain('rd:frontend,backend,fullstack');
  });

  it('should escape delimiter characters in values', () => {
    const profile: CompactDeveloperProfile = {
      u: 'user|with:special,chars',
      lp: [],
      t: ['topic|one', 'topic:two'],
      a: { c: 0, pr: 0, d: 7, r: [] },
      g: [],
      rd: [],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    // Should escape | → \P, : → \D, , → \C
    expect(result).toContain('u:user\\Pwith\\Dspecial\\Cchars');
    expect(result).toContain('t:topic\\Pone,topic\\Dtwo');
  });

  it('should use pipe as field delimiter', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [{ n: 'TypeScript', b: 1000, p: 100 }],
      t: ['react'],
      a: { c: 5, pr: 1, d: 7, r: ['repo'] },
      g: ['testing'],
      rd: ['frontend'],
      cp: 'conventional',
    };

    const result = serializeContext(profile);
    const parts = result.split('|');

    // Should have all fields
    expect(parts.some(p => p.startsWith('u:'))).toBe(true);
    expect(parts.some(p => p.startsWith('lp:'))).toBe(true);
    expect(parts.some(p => p.startsWith('t:'))).toBe(true);
    expect(parts.some(p => p.startsWith('a:'))).toBe(true);
    expect(parts.some(p => p.startsWith('g:'))).toBe(true);
    expect(parts.some(p => p.startsWith('rd:'))).toBe(true);
    expect(parts.some(p => p.startsWith('cp:'))).toBe(true);
  });

  it('should omit empty arrays from output', () => {
    const profile: CompactDeveloperProfile = {
      u: 'testuser',
      lp: [],
      t: [],
      a: { c: 0, pr: 0, d: 7, r: [] },
      g: [],
      rd: [],
      cp: 'conventional',
    };

    const result = serializeContext(profile);

    // Should not contain lp:, t:, g:, rd: when empty
    expect(result).not.toContain('lp:');
    expect(result).not.toContain('t:');
    expect(result).not.toContain('g:');
    expect(result).not.toContain('rd:');
  });
});
