import 'server-only';

import { logger } from '@/lib/logger';
import { deleteFile, ensureDir, readFile, writeFile } from '@/lib/storage/utils';
import type { AIActivityEvent } from './types';

const log = logger.withTag('ActivityShadowStore');

const SHADOW_SUBDIR = (userId: string) => `users/${userId}/activity`;
const SHADOW_FILE = 'events.json';
const MAX_SHADOW_EVENTS = 400;

interface ShadowActivityEvent
  extends Omit<AIActivityEvent, 'timestamp'> {
  timestamp: string;
}

interface ShadowActivityFile {
  version: 1;
  events: ShadowActivityEvent[];
}

const EMPTY_SHADOW_FILE: ShadowActivityFile = {
  version: 1,
  events: [],
};

function serializeEvent(event: AIActivityEvent): ShadowActivityEvent {
  return {
    ...event,
    timestamp: event.timestamp.toISOString(),
  };
}

function deserializeEvent(event: ShadowActivityEvent): AIActivityEvent {
  return {
    ...event,
    timestamp: new Date(event.timestamp),
  };
}

function parseShadowPayload(raw: string | null): ShadowActivityFile {
  if (raw === null || raw.trim().length === 0) {
    return EMPTY_SHADOW_FILE;
  }

  try {
    const parsed = JSON.parse(raw) as ShadowActivityFile;
    if (!parsed || !Array.isArray(parsed.events)) {
      return EMPTY_SHADOW_FILE;
    }
    return {
      version: 1,
      events: parsed.events.filter((event) => typeof event?.id === 'string'),
    };
  } catch (error) {
    log.warn('Failed to parse activity shadow payload', { error });
    return EMPTY_SHADOW_FILE;
  }
}

async function readShadowFile(userId: string): Promise<ShadowActivityFile> {
  const raw = await readFile(SHADOW_SUBDIR(userId), SHADOW_FILE);
  return parseShadowPayload(raw);
}

async function writeShadowFile(userId: string, payload: ShadowActivityFile): Promise<void> {
  await ensureDir(SHADOW_SUBDIR(userId), { mode: 0o700 });
  await writeFile(
    SHADOW_SUBDIR(userId),
    SHADOW_FILE,
    JSON.stringify(payload),
  );
}

export async function appendShadowActivityEvent(event: AIActivityEvent): Promise<void> {
  const current = await readShadowFile(event.userId);
  const serialized = serializeEvent(event);

  const nextEvents = [...current.events];
  const existingIndex = nextEvents.findIndex((item) => item.id === event.id);
  if (existingIndex >= 0) {
    nextEvents[existingIndex] = serialized;
  } else {
    nextEvents.push(serialized);
  }

  const trimmed = nextEvents.slice(-MAX_SHADOW_EVENTS);
  await writeShadowFile(event.userId, {
    version: 1,
    events: trimmed,
  });
}

export async function loadShadowActivityEvents(userId: string): Promise<AIActivityEvent[]> {
  const payload = await readShadowFile(userId);
  return payload.events.map(deserializeEvent);
}

export async function updateShadowActivityMetrics(
  userId: string,
  eventId: string,
  clientMetrics: {
    firstTokenMs?: number;
    totalMs?: number;
  },
): Promise<boolean> {
  const payload = await readShadowFile(userId);
  const existingIndex = payload.events.findIndex((event) => event.id === eventId);
  if (existingIndex < 0) {
    return false;
  }

  const event = payload.events[existingIndex];
  const input = event.input ?? {};
  input.clientMetrics = clientMetrics;
  event.input = input;

  if (typeof clientMetrics.totalMs === 'number') {
    event.latencyMs = clientMetrics.totalMs;
  }

  payload.events[existingIndex] = event;
  await writeShadowFile(userId, payload);
  return true;
}

export async function clearShadowActivityEvents(userId: string): Promise<void> {
  await deleteFile(SHADOW_SUBDIR(userId), SHADOW_FILE);
}
