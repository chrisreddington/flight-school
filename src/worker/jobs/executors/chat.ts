/**
 * Chat-response job executor (Phase 5 rewrite).
 *
 * Phase 5 of the streaming-architecture refactor makes the worker the
 * **sole writer** of both `background-jobs` and `threads.json`. The
 * mid-stream durable-consolidation passes (formerly every 500 ms /
 * tool_event) are gone — clients consume live state via SSE through
 * the {@link chatStreamStore} on the browser. The thread file is now
 * written exactly twice per chat job:
 *
 *   1. Before terminal: a single `consolidateFinalToThread()` call
 *      that materialises the final assistant message and clears
 *      `isStreaming`. Optionally appends `*(Response stopped)*` or
 *      `*(Response interrupted)*` for user-cancelled or
 *      worker-failed jobs respectively.
 *   2. (Implicit) any later sweep that promotes a cancelled-but-not-
 *      annotated message — see `src/app/api/internal/jobs/sweep/route.ts`.
 *
 * The terminal sequence uses the new jobStorage CAS helpers
 * (`markCompletedIdempotent`, `markFailedIfNonTerminal`,
 * `markCancelledIfNonTerminal`) together with
 * `jobEventBus.appendTerminalIfNotTerminated` so a DELETE-initiated
 * cancellation racing the worker's happy path produces a single
 * terminal frame and a single durable thread write, in either order,
 * with the user-intent annotation preserved.
 *
 * `unregisterSession()` is intentionally deferred to a `finally`
 * AFTER the terminal frame is appended; while the session is
 * registered, the DELETE handler can call `requestCancellation()`
 * to receive a trustworthy `true` and the worker will reach this
 * branch via the next `isJobStillValid` check or the SDK abort path.
 *
 * @module worker/jobs/executors/chat
 */

import { createLearningStreamingSession, createStreamingChatSession } from '@/lib/copilot/streaming';
import { jobStorage } from '@/lib/jobs';
import type { ChatResponseInput, ChatResponseResult } from '@/lib/jobs';
import { buildRepositoryContextPrompt } from '@/lib/jobs/repository-context';
import { getThreadById, updateThread } from '@/lib/jobs/storage/threads-storage';
import { logger } from '@/lib/logger';
import type { Message, ToolCallEvent } from '@/lib/threads';
import { detectActionableContent } from '@/lib/utils/content-detection';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';
import { terminalEventFromStatus } from '@/worker/jobs/streaming/types';
import { isJobStillValid, resolveJobIdentity } from './job-identity';
import { registerSession, unregisterSession } from './session-registry';
import { upsertMessageById } from './thread-consolidation';

const log = logger.withTag('JobChatExecutor');

/** Annotation appended when the user (DELETE) stopped the stream. */
export const RESPONSE_STOPPED_ANNOTATION = '\n\n*(Response stopped)*';
/** Annotation appended when the worker or sweeper interrupted the stream. */
export const RESPONSE_INTERRUPTED_ANNOTATION = '\n\n*(Response interrupted)*';

/**
 * Idempotently append `annotation` to `content` if it isn't already
 * present at the tail. Used by the cancellation/error consolidation
 * helpers so a concurrent path that already annotated the message
 * doesn't double-tag it.
 */
function appendAnnotationIdempotent(content: string, annotation: string): string {
  if (content.endsWith(annotation.trimEnd()) || content.endsWith(annotation)) return content;
  return content + annotation;
}

/**
 * Execute a chat response job.
 *
 * @see RESPONSE_STOPPED_ANNOTATION
 * @see RESPONSE_INTERRUPTED_ANNOTATION
 */
export async function executeChatResponse(
  jobId: string,
  input: ChatResponseInput,
  userId: string,
): Promise<void> {
  await jobStorage.markRunning(jobId);

  const {
    threadId,
    prompt,
    assistantMessageId: providedAssistantId,
    learningMode = false,
    useGitHubTools = false,
    repos,
  } = input;
  const assistantMessageId = providedAssistantId ?? generateMessageId();

  let fullContent = '';
  const toolCalls: string[] = [];
  const toolEvents: ToolCallEvent[] = [];
  let hasActionableItem = false;
  let sessionRegistered = false;

  /**
   * Write the final assistant message to the durable thread store.
   *
   * Always sets `isStreaming: false`. Optionally appends an annotation
   * (idempotently) to mark the message as cancelled-by-user or
   * interrupted-by-worker. Returns silently if the thread no longer
   * exists (e.g. user deleted it mid-stream).
   */
  const consolidateFinalToThread = async (annotation?: string): Promise<void> => {
    try {
      const currentThread = await getThreadById(userId, threadId);
      if (!currentThread) return;
      const contentToPersist = annotation
        ? appendAnnotationIdempotent(fullContent, annotation)
        : fullContent;
      const consolidatedMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: contentToPersist,
        timestamp: now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolEvents: toolEvents.length > 0 ? toolEvents.map((e) => ({ ...e })) : undefined,
        hasActionableItem,
      };
      const updatedMessages = upsertMessageById(
        currentThread.messages,
        assistantMessageId,
        consolidatedMessage,
        false,
      );
      await updateThread(userId, {
        ...currentThread,
        messages: updatedMessages,
        updatedAt: now(),
        isStreaming: false,
      });
      log.debug(`[Job ${jobId}] Final consolidation: ${contentToPersist.length} chars`);
    } catch (err) {
      log.warn(`[Job ${jobId}] consolidateFinalToThread failed:`, err);
    }
  };

  /** Idempotently emit the matching terminal SSE frame. No-op if already terminated. */
  const emitTerminal = (status: 'completed' | 'cancelled' | 'failed', message?: string): void => {
    try {
      jobEventBus.appendTerminalIfNotTerminated(
        jobId,
        terminalEventFromStatus(status, {
          content: fullContent,
          toolEvents: toolEvents.map((e) => ({ ...e })),
          hasActionableItem,
          message,
        }),
      );
    } catch (err) {
      log.warn(`[Job ${jobId}] Failed to emit terminal ${status} to bus:`, err);
    }
  };

  try {
    log.info(`[Job ${jobId}] Starting chat response for thread ${threadId}`);

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;

    const thread = await getThreadById(userId, threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const contextualPrompt = buildRepositoryContextPrompt(prompt, repos, useGitHubTools);
    if (contextualPrompt !== prompt) {
      log.debug(`[Job ${jobId}] Added repository context for ${repos?.length ?? 0} repos`);
    }

    const session = learningMode
      ? await createLearningStreamingSession(identity, contextualPrompt, useGitHubTools, `Job: ${jobId}`, threadId)
      : await createStreamingChatSession(identity, contextualPrompt, useGitHubTools, `Job: ${jobId}`, threadId);

    registerSession(jobId, {
      destroy: async () => {
        log.debug(`[Job ${jobId}] Destroying session via registered callback`);
        session.cleanup();
      },
    });
    sessionRegistered = true;

    let toolCounter = 0;
    let lastSnapshotMs = 0;
    const SNAPSHOT_INTERVAL_MS = 400;

    const emitSnapshot = (): void => {
      lastSnapshotMs = Date.now();
      try {
        jobEventBus.snapshot(jobId, {
          content: fullContent,
          toolEvents: toolEvents.map((e) => ({ ...e })),
          hasActionableItem,
        });
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to emit state snapshot to bus:`, err);
      }
    };

    let wasCancelled = false;
    for await (const event of session.stream) {
      if (!(await isJobStillValid(jobId))) {
        log.info(`[Job ${jobId}] Job cancelled - breaking out of stream loop`);
        wasCancelled = true;
        break;
      }

      if (event.type === 'delta') {
        fullContent += event.content;
        try {
          jobEventBus.append(jobId, { type: 'delta', content: event.content });
        } catch (err) {
          log.warn(`[Job ${jobId}] Failed to emit delta to bus:`, err);
        }
        if (Date.now() - lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) {
          emitSnapshot();
        }
      } else if (event.type === 'tool_start') {
        toolCalls.push(event.name);
        const toolCallId = `tool-${jobId}-${toolCounter++}`;
        toolEvents.push({
          id: toolCallId,
          name: event.name,
          status: 'running',
          args: event.args,
        });
        try {
          jobEventBus.append(jobId, {
            type: 'tool_start',
            toolCallId,
            name: event.name,
            args: event.args,
          });
        } catch (err) {
          log.warn(`[Job ${jobId}] Failed to emit tool_start to bus:`, err);
        }
        emitSnapshot();
      } else if (event.type === 'tool_complete') {
        let completedToolCallId: string | null = null;
        for (let i = toolEvents.length - 1; i >= 0; i--) {
          if (toolEvents[i].status === 'running' && toolEvents[i].name === event.name) {
            completedToolCallId = toolEvents[i].id;
            toolEvents[i] = {
              ...toolEvents[i],
              status: 'complete',
              result: event.result,
              durationMs: event.duration,
            };
            break;
          }
        }
        if (completedToolCallId !== null) {
          try {
            jobEventBus.append(jobId, {
              type: 'tool_complete',
              toolCallId: completedToolCallId,
              name: event.name,
              result: event.result,
              durationMs: event.duration,
            });
          } catch (err) {
            log.warn(`[Job ${jobId}] Failed to emit tool_complete to bus:`, err);
          }
        }
        emitSnapshot();
      } else if (event.type === 'done') {
        hasActionableItem = detectActionableContent(fullContent);
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    session.cleanup();

    if (wasCancelled) {
      log.info(`[Job ${jobId}] Chat response cancelled after ${fullContent.length} chars`);
      await consolidateFinalToThread(RESPONSE_STOPPED_ANNOTATION);
      const cas = await jobStorage.markCancelledIfNonTerminal(jobId);
      emitTerminal(cas.status === 'cancelled' ? 'cancelled' : (cas.status as 'completed' | 'failed'));
      return;
    }

    // Happy path: persist the durable thread first, then CAS the job.
    // Order matters: if the thread write throws we leave the job
    // non-terminal so a sweep / retry can recover; if the CAS races
    // with a concurrent cancellation we degrade gracefully below.
    await consolidateFinalToThread();
    const status = await jobStorage.markCompletedIdempotent<ChatResponseResult>(jobId, {
      threadId,
      content: fullContent,
      hasActionableItem,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (status === 'cancelled') {
      // A concurrent DELETE won the CAS race. Re-annotate the durable
      // message with the stopped marker so the user's intent is
      // preserved, and emit the matching terminal frame.
      await consolidateFinalToThread(RESPONSE_STOPPED_ANNOTATION);
      emitTerminal('cancelled');
    } else if (status === 'failed') {
      await consolidateFinalToThread(RESPONSE_INTERRUPTED_ANNOTATION);
      emitTerminal('failed', 'interrupted');
    } else {
      emitTerminal('completed');
    }

    log.info(`[Job ${jobId}] Chat response completed: ${fullContent.length} chars`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Chat response failed:`, errorMessage);
    // CAS first so a concurrent DELETE that already moved the job to
    // `cancelled` is honoured: in that case we annotate as stopped
    // (user intent), not interrupted (worker error).
    const cas = await jobStorage.markFailedIfNonTerminal(jobId, errorMessage);
    if (cas.transitioned) {
      await consolidateFinalToThread(RESPONSE_INTERRUPTED_ANNOTATION);
      emitTerminal('failed', errorMessage);
    } else if (cas.status === 'cancelled') {
      await consolidateFinalToThread(RESPONSE_STOPPED_ANNOTATION);
      emitTerminal('cancelled');
    } else {
      // Already terminal as completed — somehow the catch fired
      // after a successful happy-path completion. Don't overwrite.
      emitTerminal(cas.status as 'completed' | 'failed' | 'cancelled', errorMessage);
    }
  } finally {
    if (sessionRegistered) {
      unregisterSession(jobId);
    }
  }
}
