import { describe, expect, it } from 'vitest';

import { CATALOG, CATALOG_VERSION } from './catalog-data';
import { getStep, getTrack, loadCatalog } from './catalog';
import { SAFE_PATH_SEGMENT } from '../storage/safe-segment';
import type { Track } from './types';

describe('loadCatalog', () => {
  it('returns the catalog with its version', () => {
    const catalog = loadCatalog();
    expect(catalog.catalogVersion).toBe(CATALOG_VERSION);
    expect(catalog.tracks.length).toBeGreaterThan(0);
  });

  it('every shipped trackId and stepId is a safe path segment', () => {
    for (const track of CATALOG) {
      expect(SAFE_PATH_SEGMENT.test(track.trackId)).toBe(true);
      for (const step of track.steps) {
        expect(SAFE_PATH_SEGMENT.test(step.stepId)).toBe(true);
      }
    }
  });

  it('throws when a track carries an unsafe trackId', () => {
    const tainted: Track[] = [{ trackId: 'bad/track', title: 't', description: 'd', steps: [] }];
    expect(() => loadCatalog(tainted)).toThrow(/unsafe/i);
  });

  it('throws when a step carries an unsafe stepId', () => {
    const tainted: Track[] = [
      {
        trackId: 'ok',
        title: 't',
        description: 'd',
        steps: [{ stepId: '../escape', title: 's', summary: 'x' }],
      },
    ];
    expect(() => loadCatalog(tainted)).toThrow(/unsafe/i);
  });

  it('throws when two tracks share a trackId', () => {
    const dupes: Track[] = [
      { trackId: 'dup', title: 'a', description: 'd', steps: [] },
      { trackId: 'dup', title: 'b', description: 'd', steps: [] },
    ];
    expect(() => loadCatalog(dupes)).toThrow(/duplicate/i);
  });

  it('throws when two steps within a track share a stepId', () => {
    const dupes: Track[] = [
      {
        trackId: 'ok',
        title: 't',
        description: 'd',
        steps: [
          { stepId: 's', title: 'a', summary: 'x' },
          { stepId: 's', title: 'b', summary: 'y' },
        ],
      },
    ];
    expect(() => loadCatalog(dupes)).toThrow(/duplicate/i);
  });
});

describe('getTrack', () => {
  it('returns the matching track', () => {
    const catalog = loadCatalog();
    const first = catalog.tracks[0];
    expect(getTrack(catalog, first.trackId)).toBe(first);
  });

  it('returns undefined for an unknown trackId', () => {
    expect(getTrack(loadCatalog(), 'no-such-track')).toBeUndefined();
  });
});

describe('getStep', () => {
  it('returns the matching step within a track', () => {
    const catalog = loadCatalog();
    const track = catalog.tracks[0];
    const step = track.steps[0];
    expect(getStep(catalog, track.trackId, step.stepId)).toBe(step);
  });

  it('returns undefined for an unknown stepId', () => {
    const catalog = loadCatalog();
    const track = catalog.tracks[0];
    expect(getStep(catalog, track.trackId, 'no-such-step')).toBeUndefined();
  });

  it('returns undefined for an unknown trackId', () => {
    expect(getStep(loadCatalog(), 'nope', 'nope')).toBeUndefined();
  });
});
