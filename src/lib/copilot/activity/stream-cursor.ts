import type { AIActivityEvent } from './types';

export function mergeActivityEventStreams(
  shadowEvents: AIActivityEvent[],
  liveEvents: AIActivityEvent[],
): AIActivityEvent[] {
  const merged = new Map<string, AIActivityEvent>();

  for (const event of shadowEvents) {
    merged.set(event.id, event);
  }
  for (const event of liveEvents) {
    merged.set(event.id, event);
  }

  return [...merged.values()].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}

export function eventsAfterCursor(
  events: AIActivityEvent[],
  cursor: string | null | undefined,
): AIActivityEvent[] {
  if (!cursor) return events;

  const index = events.findIndex((event) => event.id === cursor);
  if (index < 0) return events;
  return events.slice(index + 1);
}
