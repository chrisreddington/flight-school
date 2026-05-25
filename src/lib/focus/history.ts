import {
  createStatefulChallenge,
  createStatefulGoal,
  createStatefulTopic,
  getCurrentTopicState,
} from './state-machine';
import type { FocusHistory, FocusResponse } from './types';
import { MAX_HISTORY_ENTRIES } from './types';

function isEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function pruneHistory(history: FocusHistory): FocusHistory {
  const entries = Object.entries(history);
  if (entries.length <= MAX_HISTORY_ENTRIES) {
    return history;
  }
  const sorted = entries.sort(([a], [b]) => b.localeCompare(a));
  const pruned = sorted.slice(0, MAX_HISTORY_ENTRIES);
  return Object.fromEntries(pruned);
}

export function getTodaysFocusFromHistory(history: FocusHistory, todayKey: string): FocusResponse | null {
  const record = history[todayKey];

  if (!record || record.challenges.length === 0 || record.goals.length === 0 || record.learningTopics.length === 0) {
    return null;
  }

  const latestChallenge = record.challenges[record.challenges.length - 1];
  const latestGoal = record.goals[record.goals.length - 1];
  const latestTopics = record.learningTopics[record.learningTopics.length - 1];

  if (!latestChallenge.stateHistory || !latestGoal.stateHistory || !latestTopics[0]?.stateHistory) {
    return null;
  }

  const challengeGenerated = latestChallenge.stateHistory[0].timestamp;
  const goalGenerated = latestGoal.stateHistory[0].timestamp;
  const topicsGenerated = latestTopics[0].stateHistory[0].timestamp;

  const timestamps = [challengeGenerated, goalGenerated, topicsGenerated].sort();
  const latestGeneratedAt = timestamps[timestamps.length - 1];

  const displayableTopics = latestTopics.filter((topic) => {
    const state = getCurrentTopicState(topic);
    if (state === 'skipped') return false;
    if (state === 'explored' && topic.data.replacedByTopicId) return false;
    return true;
  });

  const sortedTopics = displayableTopics.sort((a, b) => {
    const stateA = getCurrentTopicState(a);
    const stateB = getCurrentTopicState(b);
    if (stateA === 'not-explored' && stateB === 'explored') return -1;
    if (stateA === 'explored' && stateB === 'not-explored') return 1;
    return 0;
  });

  const dashboardTopics = sortedTopics.slice(0, 3);

  return {
    challenge: latestChallenge.data,
    goal: latestGoal.data,
    learningTopics: dashboardTopics.map((topic) => topic.data),
    calibrationNeeded: record.calibrationNeeded,
    meta: {
      generatedAt: latestGeneratedAt,
      aiEnabled: true,
      model: 'stored',
      toolsUsed: [],
      totalTimeMs: 0,
      usedCachedProfile: true,
    },
  };
}

export function saveFocusToHistory(history: FocusHistory, todayKey: string, focus: FocusResponse): FocusHistory {
  if (!history[todayKey]) {
    history[todayKey] = {
      challenges: [],
      goals: [],
      learningTopics: [],
    };
  }
  const record = history[todayKey];

  const isValidChallenge = focus.challenge?.id && focus.challenge?.title;
  const isValidGoal = focus.goal?.id && focus.goal?.title;
  const hasValidTopics =
    focus.learningTopics?.length > 0 && focus.learningTopics.every((topic) => topic.id && topic.title);

  if (isValidChallenge) {
    const lastChallenge = record.challenges[record.challenges.length - 1];
    if (!lastChallenge || !isEqual(lastChallenge.data, focus.challenge)) {
      const statefulChallenge = createStatefulChallenge(focus.challenge);
      record.challenges.push(statefulChallenge);
    }
  }

  if (isValidGoal) {
    const lastGoal = record.goals[record.goals.length - 1];
    if (!lastGoal || !isEqual(lastGoal.data, focus.goal)) {
      const statefulGoal = createStatefulGoal(focus.goal);
      record.goals.push(statefulGoal);
    }
  }

  if (hasValidTopics) {
    const lastTopics = record.learningTopics[record.learningTopics.length - 1];
    const topicsChanged =
      !lastTopics ||
      !isEqual(
        lastTopics.map((topic) => topic.data),
        focus.learningTopics,
      );

    if (topicsChanged) {
      const statefulTopics = focus.learningTopics.map((topic) => createStatefulTopic(topic));
      record.learningTopics.push(statefulTopics);
    }
  }

  if (focus.calibrationNeeded && focus.calibrationNeeded.length > 0) {
    const existingIds = new Set(record.calibrationNeeded?.map((item) => item.skillId) || []);
    const newItems = focus.calibrationNeeded.filter((item) => !existingIds.has(item.skillId));
    record.calibrationNeeded = [...(record.calibrationNeeded || []), ...newItems];
  }

  return pruneHistory(history);
}
