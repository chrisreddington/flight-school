import type { FocusHistory } from './types';

export function markTopicReviewedInHistory(
  history: FocusHistory,
  dateKey: string,
  topicId: string,
  reviewedAt: string,
): boolean {
  const record = history[dateKey];
  if (!record) return false;

  for (const topicArray of record.learningTopics) {
    const topic = topicArray.find((statefulTopic) => statefulTopic.data.id === topicId);
    if (topic) {
      topic.data.lastReviewedAt = reviewedAt;
      return true;
    }
  }

  return false;
}
