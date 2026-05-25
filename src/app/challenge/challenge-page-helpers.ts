'use client';

import { useEffect } from 'react';

import type { ChallengeDef } from '@/lib/copilot/types';

const DEFAULT_CHALLENGE: ChallengeDef = {
  title: 'Practice Challenge',
  description: 'Write a solution to the coding challenge.',
  type: 'implement',
  language: 'TypeScript',
  difficulty: 'beginner',
  testCases: [],
};

/**
 * Maps URL search params into a {@link ChallengeDef} + stable id, falling back
 * to {@link DEFAULT_CHALLENGE} when no `title` is provided. Pure — exported so
 * the page coordinator stays focused on rendering.
 */
export function parseChallengeFromSearchParams(searchParams: URLSearchParams): {
  challengeId: string;
  challenge: ChallengeDef;
} {
  const id = searchParams.get('id');
  const title = searchParams.get('title');
  const description = searchParams.get('description');
  const type = searchParams.get('type') as ChallengeDef['type'];
  const brokenCode = searchParams.get('brokenCode');
  const language = searchParams.get('language');
  const difficulty = searchParams.get('difficulty') as ChallengeDef['difficulty'];

  if (!title) {
    return { challengeId: 'default-challenge', challenge: DEFAULT_CHALLENGE };
  }

  const actualId =
    id ||
    `challenge-${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)}`;

  return {
    challengeId: actualId,
    challenge: {
      title,
      description: description ?? '',
      type: type || 'implement',
      brokenCode: brokenCode ?? undefined,
      language: language ?? 'TypeScript',
      difficulty: difficulty || 'beginner',
      testCases: [],
    },
  };
}

/**
 * Warms the Monaco editor chunk in the background during idle time so that
 * first interaction with the sandbox is instant. Silently no-ops if the
 * preload fails — the editor loads on demand anyway.
 */
export function useMonacoPreload() {
  useEffect(() => {
    const preload = () => {
      import('@monaco-editor/react').catch(() => {
        /* fall through to on-demand load */
      });
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(preload, 100);
    return () => clearTimeout(id);
  }, []);
}
