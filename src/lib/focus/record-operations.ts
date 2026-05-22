import {
  createStatefulChallenge,
  createStatefulGoal,
  createStatefulTopic,
} from './state-machine';
import type {
  CalibrationNeededItem,
  DailyChallenge,
  DailyGoal,
  FocusHistory,
  LearningTopic,
} from './types';

export type AddChallengeResult = 'added' | 'duplicate';
export type SelfExplanationResult =
  | 'updated'
  | 'empty'
  | 'missing-record'
  | 'missing-challenge'
  | 'missing-topic';

export function saveSelfExplanationInHistory(
  history: FocusHistory,
  dateKey: string,
  itemType: 'challenge' | 'topic',
  itemId: string,
  text: string,
): SelfExplanationResult {
  const trimmedText = text.trim();
  if (!trimmedText) return 'empty';

  const record = history[dateKey];
  if (!record) return 'missing-record';

  if (itemType === 'challenge') {
    const challenge = record.challenges.find((item) => item.data.id === itemId);
    if (!challenge) return 'missing-challenge';
    challenge.data.selfExplanation = trimmedText;
    return 'updated';
  }

  for (const topicArray of record.learningTopics) {
    const topic = topicArray.find((item) => item.data.id === itemId);
    if (topic) {
      topic.data.selfExplanation = trimmedText;
      return 'updated';
    }
  }

  return 'missing-topic';
}

export function getTopicPositionFromHistory(
  history: FocusHistory,
  dateKey: string,
  topicId: string,
): number | null {
  const record = history[dateKey];
  if (!record || record.learningTopics.length === 0) return null;

  const topicArray = record.learningTopics[record.learningTopics.length - 1];
  let activePosition = 0;
  for (const statefulTopic of topicArray) {
    if (statefulTopic.data.id === topicId) {
      return activePosition;
    }

    const lastState = statefulTopic.stateHistory[statefulTopic.stateHistory.length - 1]?.state;
    if (lastState !== 'skipped') {
      activePosition++;
    }
  }

  return null;
}

export function addTopicToHistory(
  history: FocusHistory,
  dateKey: string,
  newTopic: LearningTopic,
  position?: number,
): boolean {
  const record = history[dateKey];
  if (!record || record.learningTopics.length === 0) return false;

  const topicArray = record.learningTopics[record.learningTopics.length - 1];
  const statefulNewTopic = createStatefulTopic(newTopic);

  if (position !== undefined && position >= 0 && position <= topicArray.length) {
    topicArray.splice(position, 0, statefulNewTopic);
  } else {
    topicArray.push(statefulNewTopic);
  }

  return true;
}

export function markTopicReplacedInHistory(
  history: FocusHistory,
  dateKey: string,
  oldTopicId: string,
  newTopicId: string,
): boolean {
  const record = history[dateKey];
  if (!record || record.learningTopics.length === 0) return false;

  const topicArray = record.learningTopics[record.learningTopics.length - 1];
  const topic = topicArray.find((item) => item.data.id === oldTopicId);
  if (!topic) return false;

  topic.data.replacedByTopicId = newTopicId;
  return true;
}

export function removeCalibrationItemFromHistory(
  history: FocusHistory,
  todayKey: string,
  skillId: string,
): boolean {
  const record = history[todayKey];
  if (!record || !record.calibrationNeeded) return false;

  record.calibrationNeeded = record.calibrationNeeded.filter((item) => item.skillId !== skillId);
  return true;
}

export function getCalibrationNeededFromHistory(
  history: FocusHistory,
  todayKey: string,
): CalibrationNeededItem[] {
  return history[todayKey]?.calibrationNeeded || [];
}

export function addChallengeToHistory(
  history: FocusHistory,
  dateKey: string,
  newChallenge: DailyChallenge,
): AddChallengeResult {
  if (!history[dateKey]) {
    history[dateKey] = { challenges: [], goals: [], learningTopics: [] };
  }
  const record = history[dateKey];

  if (record.challenges.some((challenge) => challenge.data.id === newChallenge.id)) {
    return 'duplicate';
  }

  record.challenges.push(createStatefulChallenge(newChallenge));
  return 'added';
}

export function addGoalToHistory(
  history: FocusHistory,
  dateKey: string,
  newGoal: DailyGoal,
): boolean {
  const record = history[dateKey];
  if (!record) return false;

  record.goals.push(createStatefulGoal(newGoal));
  return true;
}
