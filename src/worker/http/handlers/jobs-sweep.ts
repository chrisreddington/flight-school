/** Handler for `POST /api/internal/jobs/sweep`. */

import { parseJsonBody } from '@/lib/api/request-utils';
import { jobStorage } from '@/lib/jobs';
import { getThreadById, updateThread } from '@/lib/jobs/storage/threads-storage';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';
import { RESPONSE_INTERRUPTED_ANNOTATION } from '@/worker/jobs/executors/chat';
import {
  redactTerminalJobs,
  sweepOrphanJobs,
  sweepStaleRunningJobs,
} from '@/worker/jobs/retention';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';

const log = logger.withTag('JobsSweepRoute');

export async function handleJobsSweep(request: Request): Promise<Response> {
  let nowMs = Date.now();
  try {
    const parseResult = await parseJsonBody<unknown>(request);
    if (parseResult.success && typeof parseResult.data === 'object' && parseResult.data !== null) {
      const candidate = (parseResult.data as { nowMs?: unknown }).nowMs;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) nowMs = candidate;
    }
  } catch {
    // unparseable body — default to Date.now()
  }

  const staleRunningJobs = await sweepStaleRunningJobs(nowMs);

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

  return Response.json({
    staleRunningJobs,
    orphanJobs,
    redactedTerminalJobs,
    sweptEventBuffers,
  });
}
