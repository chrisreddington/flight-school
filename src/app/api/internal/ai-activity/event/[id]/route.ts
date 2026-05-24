/**
 * Worker-internal AI activity event PATCH endpoint.
 *
 * `PATCH /api/internal/ai-activity/event/:id`
 *   Body: `{ status?, output?, error?, latencyMs?, clientMetrics?, serverMetrics? }`.
 *   Updates the retained event, broadcasts an updated `event` frame,
 *   persists. Returns 404 if the event is unknown or not owned by
 *   `x-user-id`.
 */
import { parseJsonBody } from '@/lib/api/request-utils';
import { activityLoggerWorker } from '@/lib/copilot/activity/logger-worker';
import type {
  AIActivityOutput,
  AIActivityStatus,
} from '@/lib/copilot/activity/types';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

import { authorizeInternalActivity } from '../../auth';

// Guarded by COPILOT_WORKER_SECRET via authorizeInternalActivity.


interface Params {
  params: Promise<{ id: string }>;
}

const ALLOWED_STATUSES: readonly AIActivityStatus[] = ['pending', 'success', 'error'];

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

async function handlePatch(request: NextRequest, eventId: string) {
  const authResult = authorizeInternalActivity(request);
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.auth;

  const parsed = await parseJsonBody<PatchEventBody>(request);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
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
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  return NextResponse.json({ id: eventId });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  return withExtractedTraceContext(request.headers, async () => handlePatch(request, id));
}
