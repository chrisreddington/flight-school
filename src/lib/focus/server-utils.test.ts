import { describe, expect, it } from 'vitest';

import { addMissingIds } from './server-utils';

describe('addMissingIds', () => {
  it('preserves dominantSignal on learning topics so post-processing can diversify', () => {
    const normalized = addMissingIds(
      {
        learningTopics: [
          {
            title: 'Repo-specific topic',
            description: 'desc',
            type: 'concept',
            relatedTo: 'repo',
            dominantSignal: 'current-repo',
          },
        ],
      },
      ['learningTopics'],
    );

    expect(normalized.learningTopics).toBeDefined();
    expect(normalized.learningTopics?.[0].dominantSignal).toBe('current-repo');
  });
});
