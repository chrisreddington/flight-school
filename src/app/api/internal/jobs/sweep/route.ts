/**
 * Internal worker endpoint that aggregates the four global sweeps.
 *
 * `POST /api/internal/jobs/sweep` with optional `{ nowMs }` for
 * deterministic tests. Returns count summaries only — never raw user
 * content.
 */

import { parseJsonBody } from '@/lib/api/request-utils';
import { jobStorage } from '@/lib/jobs';
import { getThreadById, updateThread } from '@/lib/jobs/storage/threads-storage';
import { logger } from '@/lib/logger';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { now } from '@/lib/utils/date-utils';
import {
  RESPONSE_INTERRUPTED_ANNOTATION,
} from '@/worker/jobs/executors/chat';
import {
  redactTerminalJobs,
  sweepOrphanJobs,
  sweepStaleRunningJobs,
} from '@/worker/jobs/retention';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('JobsSweepRoute');

function authorize(request: NextRequest): NextResponse | null {
  if (process.env.COPILOT_WORKER_MODE !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const secret = process.env.COPILOT_WORKER_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'COPILOT_WORKER_SECRET is not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

async function handleSweep(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  let nowMs = Date.now();
  try {
    const parseResult = await parseJsonBody<unknown>(request);
    if (parseResult.success && typeof parseResult.data === 'object' && parseResult.data !== null) {
      const candidate = (parseResult.data as { nowMs?: unknown }).nowMs;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        nowMs = candidate;
      }
    }
  } catch {
    // No body / unparseable body — default to Date.now().
  }

  const staleRunningJobs = await sweepStaleRunningJobs(nowMs);

  // Phase 5: for every stale chat-response job we just transitioned
  // to `failed`, annotate the durable thread with the worker-side
  // interrupted marker and emit a terminal SSE frame for any
  // subscribers still attached to the bus. The annotation lookup is
  // idempotent on tail-match so re-running the sweep does not
  // double-tag.
  for (const id of staleRunningJobs.sweptIds ?? []) {
    try {
      const job = await jobStorage.get(id);
      if (!job || job.type !== 'chat-response' || !job.userId) continue;
      const input = (job.input ?? {}) as { threadId?: string; assistantMessageId?: string };
      if (!input.threadId) continue;
      const thread = await getThreadById(job.userId, input.threadId);
      if (!thread) continue;
      let mutated = false;
      const nextMessages = thread.messages.map((m) => {
        if (m.role !== 'assistant') return m;
        if (input.assistantMessageId && m.id !== input.assistantMessageId) return m;
        if (m.content.endsWith(RESPONSE_INTERRUPTED_ANNOTATION.trimEnd())) return m;
        mutated = true;
        return { ...m, content: m.content + RESPONSE_INTERRUPTED_ANNOTATION };
      });
      if (mutated || thread.isStreaming) {
        await updateThread(job.userId, {
          ...thread,
          messages: nextMessages,
          isStreaming: false,
          updatedAt: now(),
        });
      }
      jobEventBus.appendTerminalIfNotTerminated(id, {
        type: 'failed',
        message: 'Job interrupted by sweep',
      });
    } catch (err) {
      log.warn(`[sweep] annotation/terminal emit failed for ${id}`, err);
    }
  }

  const orphanJobs = await sweepOrphanJobs();
  const redactedTerminalJobs = await redactTerminalJobs();
  const sweptEventBuffers = jobEventBus.sweep(nowMs);

  return NextResponse.json({
    staleRunningJobs,
    orphanJobs,
    redactedTerminalJobs,
    sweptEventBuffers,
  });
}

export async function POST(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleSweep(request));
}
