/**
 * Worker-internal AI activity event create endpoint.
 *
 * `POST /api/internal/ai-activity/event`
 *   Body: `{ type, operationName, input?, status, output?, error? }`.
 *   The worker assigns `id` + `timestamp`, broadcasts on the bus, and
 *   persists to the durable store. Returns `{ id }`.
 *
 *   Status is required so callers can choose between "start an
 *   operation" (`pending`, paired with a later PATCH) and "log a quick
 *   event" (`success`/`error`, single POST).
 */
import { parseJsonBody } from '@/lib/api/request-utils';
import { activityLoggerWorker } from '@/lib/copilot/activity/logger-worker';
import type {
  AIActivityInput,
  AIActivityOutput,
  AIActivityStatus,
  AIActivityType,
} from '@/lib/copilot/activity/types';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

import { authorizeInternalActivity } from '../auth';

// Guarded by COPILOT_WORKER_SECRET via authorizeInternalActivity.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

async function handlePost(request: NextRequest) {
  const authResult = authorizeInternalActivity(request);
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.auth;

  const parsed = await parseJsonBody<CreateEventBody>(request);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.data;

  if (typeof body.type !== 'string' || !ALLOWED_TYPES.includes(body.type as AIActivityType)) {
    return NextResponse.json({ error: 'type is invalid' }, { status: 400 });
  }
  if (typeof body.operationName !== 'string' || body.operationName.length === 0) {
    return NextResponse.json({ error: 'operationName is required' }, { status: 400 });
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
    return NextResponse.json({ id: event.id });
  }

  const { eventId } = activityLoggerWorker.logEvent(
    userId,
    body.type as AIActivityType,
    body.operationName,
    (body.input ?? undefined) as AIActivityInput | undefined,
    (body.output ?? undefined) as AIActivityOutput | undefined,
    status,
  );
  // Apply terminal error message if provided.
  if (status === 'error' && typeof body.error === 'string') {
    activityLoggerWorker.applyUpdate(userId, eventId, { error: body.error });
  }
  return NextResponse.json({ id: eventId });
}

export async function POST(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handlePost(request));
}
