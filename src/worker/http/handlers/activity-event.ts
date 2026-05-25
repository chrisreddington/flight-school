/** Handlers for `/api/internal/ai-activity/event` (POST) and `/event/:id` (PATCH). */

import { parseJsonBody } from '@/lib/api/request-utils';
import { activityLoggerWorker } from '@/lib/copilot/activity/logger-worker';
import type {
  AIActivityInput,
  AIActivityOutput,
  AIActivityStatus,
  AIActivityType,
} from '@/lib/copilot/activity/types';

const ALLOWED_TYPES: readonly AIActivityType[] = [
  'embed',
  'ask',
  'session',
  'tool',
  'error',
  'internal',
];
const ALLOWED_STATUSES: readonly AIActivityStatus[] = ['pending', 'success', 'error'];

interface CreateEventBody {
  type?: unknown;
  operationName?: unknown;
  input?: unknown;
  output?: unknown;
  status?: unknown;
  error?: unknown;
}

interface PatchEventBody {
  status?: unknown;
  output?: unknown;
  error?: unknown;
  latencyMs?: unknown;
  clientMetrics?: unknown;
  serverMetrics?: unknown;
}

function pickStatus(value: unknown): AIActivityStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return ALLOWED_STATUSES.includes(value as AIActivityStatus)
    ? (value as AIActivityStatus)
    : undefined;
}

function pickMetrics(value: unknown): { firstTokenMs?: number; totalMs?: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as { firstTokenMs?: unknown; totalMs?: unknown };
  const out: { firstTokenMs?: number; totalMs?: number } = {};
  if (typeof raw.firstTokenMs === 'number') out.firstTokenMs = raw.firstTokenMs;
  if (typeof raw.totalMs === 'number') out.totalMs = raw.totalMs;
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickServerMetrics(
  value: unknown,
): { firstTokenMs?: number | null; totalMs?: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as { firstTokenMs?: unknown; totalMs?: unknown };
  const out: { firstTokenMs?: number | null; totalMs?: number } = {};
  if (raw.firstTokenMs === null || typeof raw.firstTokenMs === 'number') {
    out.firstTokenMs = raw.firstTokenMs;
  }
  if (typeof raw.totalMs === 'number') out.totalMs = raw.totalMs;
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function handleActivityEventCreate(
  request: Request,
  userId: string,
): Promise<Response> {
  const parsed = await parseJsonBody<CreateEventBody>(request);
  if (!parsed.success) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.data;

  if (typeof body.type !== 'string' || !ALLOWED_TYPES.includes(body.type as AIActivityType)) {
    return Response.json({ error: 'type is invalid' }, { status: 400 });
  }
  if (typeof body.operationName !== 'string' || body.operationName.length === 0) {
    return Response.json({ error: 'operationName is required' }, { status: 400 });
  }
  const status: AIActivityStatus =
    typeof body.status === 'string' && ALLOWED_STATUSES.includes(body.status as AIActivityStatus)
      ? (body.status as AIActivityStatus)
      : 'pending';

  await activityLoggerWorker.ensureHydrated(userId);

  if (status === 'pending') {
    const event = activityLoggerWorker.createPending(
      userId,
      body.type as AIActivityType,
      body.operationName,
      (body.input ?? undefined) as AIActivityInput | undefined,
    );
    return Response.json({ id: event.id });
  }

  const { eventId } = activityLoggerWorker.logEvent(
    userId,
    body.type as AIActivityType,
    body.operationName,
    (body.input ?? undefined) as AIActivityInput | undefined,
    (body.output ?? undefined) as AIActivityOutput | undefined,
    status,
  );
  if (status === 'error' && typeof body.error === 'string') {
    activityLoggerWorker.applyUpdate(userId, eventId, { error: body.error });
  }
  return Response.json({ id: eventId });
}

export async function handleActivityEventPatch(
  request: Request,
  eventId: string,
  userId: string,
): Promise<Response> {
  const parsed = await parseJsonBody<PatchEventBody>(request);
  if (!parsed.success) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.data;

  await activityLoggerWorker.ensureHydrated(userId);

  const updated = activityLoggerWorker.applyUpdate(userId, eventId, {
    status: pickStatus(body.status),
    output: (body.output ?? undefined) as AIActivityOutput | undefined,
    error: typeof body.error === 'string' ? body.error : undefined,
    latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : undefined,
    clientMetrics: pickMetrics(body.clientMetrics),
    serverMetrics: pickServerMetrics(body.serverMetrics),
  });

  if (!updated) {
    return Response.json({ error: 'Event not found' }, { status: 404 });
  }
  return Response.json({ id: eventId });
}
