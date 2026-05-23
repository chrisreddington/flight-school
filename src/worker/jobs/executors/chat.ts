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
import { isJobStillValid, resolveJobIdentity } from './job-identity';
import { registerSession, unregisterSession } from './session-registry';
import {
  STREAM_CURSOR,
  upsertMessageById,
} from './thread-consolidation';

const log = logger.withTag('JobChatExecutor');

/**
 * Execute a chat response job.
 * Generates AI response and saves it incrementally to thread storage.
 */
export async function executeChatResponse(
  jobId: string,
  input: ChatResponseInput,
  userId: string,
): Promise<void> {
  await jobStorage.markRunning(jobId);

  const { threadId, prompt, assistantMessageId: providedAssistantId, learningMode = false, useGitHubTools = false, repos } = input;
  const assistantMessageId = providedAssistantId ?? generateMessageId();

  // Stream-state is hoisted to the outer scope so the catch block can
  // consolidate whatever partial assistant content was assembled before
  // the error and finalise the thread (clears `isStreaming`).
  let fullContent = '';
  const toolCalls: string[] = [];
  const toolEvents: ToolCallEvent[] = [];
  let hasActionableItem = false;

  const consolidateToThread = async (isFinal: boolean) => {
    try {
      const currentThread = await getThreadById(userId, threadId);
      if (!currentThread) return;

      const consolidatedMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: fullContent + (isFinal ? '' : STREAM_CURSOR),
        timestamp: now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolEvents: toolEvents.length > 0 ? toolEvents.map(e => ({ ...e })) : undefined,
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
        isStreaming: !isFinal,
      });

      log.debug(`[Job ${jobId}] Consolidated to thread: ${fullContent.length} chars, final=${isFinal}`);
    } catch (err) {
      log.warn(`[Job ${jobId}] Failed to consolidate to thread:`, err);
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

    let toolCounter = 0;
    let lastSnapshotMs = 0;
    let lastDurableWriteMs = 0;
    const SNAPSHOT_INTERVAL_MS = 400;
    const DURABLE_WRITE_INTERVAL_MS = 500;

    // Emit a rolling state snapshot to the in-process event bus so SSE
    // subscribers (and reconnects past the buffer cap) can recover the
    // latest assembled state in one event without replaying every delta.
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
        // Emit a state_snapshot periodically during delta-only streams so
        // (a) late subscribers past the ring-buffer cap can recover full
        // assembled content via the replayed snapshot, and (b) any reader
        // dropping into the SSE stream sees a coherent rolling view.
        if (Date.now() - lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) {
          emitSnapshot();
        }
        // Periodically write partial assistant content to the durable
        // thread store. With the scratchpad gone, this is what makes
        // live content visible to clients that refresh threads.json
        // (e.g. when navigating back to a streaming thread).
        if (Date.now() - lastDurableWriteMs >= DURABLE_WRITE_INTERVAL_MS) {
          lastDurableWriteMs = Date.now();
          try {
            await consolidateToThread(false);
          } catch (err) {
            log.warn(`[Job ${jobId}] Periodic durable write failed:`, err);
          }
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
        try {
          await consolidateToThread(false);
          lastDurableWriteMs = Date.now();
        } catch (err) {
          log.warn(`[Job ${jobId}] tool_start durable write failed:`, err);
        }
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
        try {
          await consolidateToThread(false);
          lastDurableWriteMs = Date.now();
        } catch (err) {
          log.warn(`[Job ${jobId}] tool_complete durable write failed:`, err);
        }
      } else if (event.type === 'done') {
        hasActionableItem = detectActionableContent(fullContent);
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    session.cleanup();
    unregisterSession(jobId);

    if (wasCancelled) {
      log.info(`[Job ${jobId}] Chat response cancelled after ${fullContent.length} chars`);
      await consolidateToThread(true);
      try {
        jobEventBus.append(jobId, {
          type: 'cancelled',
          content: fullContent,
          toolEvents: toolEvents.map((e) => ({ ...e })),
        });
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to emit cancelled to bus:`, err);
      }
      return;
    }

    await consolidateToThread(true);

    await jobStorage.markCompleted<ChatResponseResult>(jobId, {
      threadId,
      content: fullContent,
      hasActionableItem,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    try {
      jobEventBus.append(jobId, {
        type: 'done',
        content: fullContent,
        toolEvents: toolEvents.map((e) => ({ ...e })),
        hasActionableItem,
      });
    } catch (err) {
      log.warn(`[Job ${jobId}] Failed to emit done to bus:`, err);
    }

    log.info(`[Job ${jobId}] Chat response completed: ${fullContent.length} chars`);
  } catch (error) {
    unregisterSession(jobId);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Chat response failed:`, errorMessage);
    // Finalise whatever partial assistant content was assembled before
    // the error. `consolidateToThread(true)` clears `isStreaming` and
    // upserts the partial message so the UI doesn't show a stuck cursor.
    try {
      await consolidateToThread(true);
    } catch (consolidationErr) {
      log.warn(`[Job ${jobId}] Failed to consolidate after error:`, consolidationErr);
    }
    try {
      jobEventBus.append(jobId, { type: 'failed', message: errorMessage });
    } catch (err) {
      log.warn(`[Job ${jobId}] Failed to emit failed to bus:`, err);
    }
    await jobStorage.markFailed(jobId, errorMessage);
  }
}
