import { createLearningStreamingSession, createStreamingChatSession } from '@/lib/copilot/streaming';
import { jobStorage } from '@/lib/jobs';
import type { ChatResponseInput, ChatResponseResult } from '@/lib/jobs';
import { buildRepositoryContextPrompt } from '@/lib/jobs/repository-context';
import { logger } from '@/lib/logger';
import { deleteScratchpad, writeScratchpad } from '@/lib/storage/scratchpad';
import type { Message, ToolCallEvent } from '@/lib/threads';
import { detectActionableContent } from '@/lib/utils/content-detection';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { getThreadById, updateThread } from '../threads-storage';
import { isJobStillValid, resolveJobIdentity } from './job-identity';
import { registerSession, unregisterSession } from './session-registry';
import {
  consolidateScratchpadToThread,
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

    let fullContent = '';
    const toolCalls: string[] = [];
    const toolEvents: ToolCallEvent[] = [];
    let toolCounter = 0;
    let hasActionableItem = false;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 400;

    const flushScratchpad = async (status: 'streaming' | 'completed' | 'failed') => {
      try {
        await writeScratchpad(userId, jobId, {
          threadId,
          assistantMessageId,
          content: fullContent,
          toolEvents: toolEvents.length > 0 ? toolEvents.map(e => ({ ...e })) : undefined,
          hasActionableItem,
          status,
        });
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to flush scratchpad:`, err);
      }
    };

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

        await deleteScratchpad(userId, jobId);

        log.debug(`[Job ${jobId}] Consolidated to thread: ${fullContent.length} chars, final=${isFinal}`);
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to consolidate to thread:`, err);
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

        const nowMs = Date.now();
        if (nowMs - lastSaveTime >= SAVE_INTERVAL_MS) {
          await flushScratchpad('streaming');
          lastSaveTime = nowMs;
        }
      } else if (event.type === 'tool_start') {
        toolCalls.push(event.name);
        toolEvents.push({
          id: `tool-${jobId}-${toolCounter++}`,
          name: event.name,
          status: 'running',
          args: event.args,
        });
        await flushScratchpad('streaming');
        lastSaveTime = Date.now();
      } else if (event.type === 'tool_complete') {
        for (let i = toolEvents.length - 1; i >= 0; i--) {
          if (toolEvents[i].status === 'running' && toolEvents[i].name === event.name) {
            toolEvents[i] = {
              ...toolEvents[i],
              status: 'complete',
              result: event.result,
              durationMs: event.duration,
            };
            break;
          }
        }
        await flushScratchpad('streaming');
        lastSaveTime = Date.now();
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
      return;
    }

    await consolidateToThread(true);

    await jobStorage.markCompleted<ChatResponseResult>(jobId, {
      threadId,
      content: fullContent,
      hasActionableItem,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    log.info(`[Job ${jobId}] Chat response completed: ${fullContent.length} chars`);
  } catch (error) {
    unregisterSession(jobId);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Chat response failed:`, errorMessage);
    try {
      await consolidateScratchpadToThread(userId, jobId, true);
    } catch (consolidationErr) {
      log.warn(`[Job ${jobId}] Failed to consolidate after error:`, consolidationErr);
    }
    await jobStorage.markFailed(jobId, errorMessage);
  }
}
