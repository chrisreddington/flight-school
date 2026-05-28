import { describe, expect, it } from 'vitest';

import type { LearningTopic } from '@/lib/focus/base-types';
import { diversifyLearningTopics } from '@/lib/focus/diversify-topics';

function topic(id: string, signal?: LearningTopic['dominantSignal']): LearningTopic {
  return {
    id,
    title: id,
    description: '',
    type: 'concept',
    relatedTo: '',
    dominantSignal: signal,
  };
}

describe('diversifyLearningTopics', () => {
  it('returns up to 3 topics', () => {
    const out = diversifyLearningTopics([
      topic('a', 'top-language'),
      topic('b', 'declared-skill'),
      topic('c', 'top-language'),
      topic('d', 'declared-skill'),
      topic('e', 'top-language'),
    ]);
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps at most one current-repo topic', () => {
    const out = diversifyLearningTopics([
      topic('repo1', 'current-repo'),
      topic('repo2', 'current-repo'),
      topic('lang', 'top-language'),
      topic('skill', 'declared-skill'),
      topic('repo3', 'current-repo'),
    ]);
    expect(out.map((t) => t.id)).toEqual(['repo1', 'lang', 'skill']);
    expect(out.filter((t) => t.dominantSignal === 'current-repo')).toHaveLength(1);
  });

  it('keeps current-repo topics at <= 1 even under backfill pressure', () => {
    const out = diversifyLearningTopics([
      topic('repo1', 'current-repo'),
      topic('repo2', 'current-repo'),
      topic('repo3', 'current-repo'),
      topic('repo4', 'current-repo'),
      topic('repo5', 'current-repo'),
    ]);
    expect(out).toHaveLength(1);
    expect(out.map((t) => t.id)).toEqual(['repo1']);
    expect(out.filter((t) => t.dominantSignal === 'current-repo')).toHaveLength(1);
  });

  it('treats missing dominantSignal as non-current-repo', () => {
    const out = diversifyLearningTopics([topic('legacy1'), topic('repo1', 'current-repo'), topic('legacy2')]);
    expect(out.map((t) => t.id)).toEqual(['legacy1', 'repo1', 'legacy2']);
  });

  it('returns fewer than 3 when fewer candidates exist', () => {
    const out = diversifyLearningTopics([topic('a', 'top-language')]);
    expect(out).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(diversifyLearningTopics([])).toEqual([]);
  });
});
