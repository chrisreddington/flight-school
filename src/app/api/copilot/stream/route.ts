/**
 * Copilot Chat Streaming API Route
 * POST /api/copilot/stream
 *
 * Uses Server-Sent Events (SSE) to stream responses as they're generated.
 * This provides immediate feedback to users instead of waiting 5+ seconds.
 *
 * Request body:
 * - prompt: string - The user's message
 * - useGitHubTools: boolean - Whether to enable MCP GitHub tools (slower but more capable)
 * - threadId: string - Optional thread ID for conversation attribution
 * - learningMode: boolean - Whether to use learning lens prompts (explains reasoning, suggests follow-ups)
 * - conversationId: string - Optional conversation ID for session reuse
 *
 * Response (SSE events):
 * - delta: { type: 'delta', content: string } - Incremental content
 * - tool_start: { type: 'tool_start', name: string, args: unknown } - MCP tool started
 * - tool_complete: { type: 'tool_complete', name: string, result: string, duration: number }
 * - meta: { type: 'meta', ..., hasActionableItem: boolean } - Final metadata
 * - [DONE]: End of stream
 *
 * @see SPEC-001 for multi-thread learning chat requirements
 */

import { createSSEResponse, parseJsonBody } from '@/lib/api';
import { nowMs } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';
import {
    type CopilotStreamRequest,
    validateCopilotStreamRequest,
} from '@/lib/copilot/api-requests';
import { createLearningStreamingSession, createStreamingChatSession } from '@/lib/copilot/streaming';
import { detectActionableContent } from '@/lib/utils/content-detection';
import { NextRequest } from 'next/server';

const log = logger.withTag('Copilot Stream');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const startTime = nowMs();
  
  try {
    const parseResult = await parseJsonBody<CopilotStreamRequest>(request);
    if (!parseResult.success) {
      return new Response(JSON.stringify({ error: parseResult.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validationError = validateCopilotStreamRequest(parseResult.data);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      prompt,
      useGitHubTools = false,
      threadId,
      learningMode = false,
      conversationId,
      repos = [],
    } = parseResult.data;

    // Determine session type for logging
    const sessionType = learningMode
      ? 'Learning Chat (streaming)'
      : useGitHubTools
        ? 'GitHub Chat (streaming)'
        : 'Chat (streaming)';

    log.debug(`${sessionType} - Starting...`, { 
      threadId, 
      repos: repos.length > 0 ? repos.join(', ') : undefined 
    });

    // Build the effective prompt with repo context if provided
    let effectivePrompt = prompt;
    if (repos && repos.length > 0) {
      const repoContext = `[Context: The user is asking about these repositories: ${repos.join(', ')}. When using GitHub tools, focus on these repos unless asked otherwise.]\n\n`;
      effectivePrompt = repoContext + prompt;
    }

    // Create streaming session - use learning mode if enabled
    const { stream, cleanup, model, sessionMetrics, streamingMetrics } = learningMode
      ? await createLearningStreamingSession(effectivePrompt, useGitHubTools, sessionType, conversationId)
      : await createStreamingChatSession(effectivePrompt, useGitHubTools, sessionType, conversationId);

    const sessionCreateTime = nowMs() - startTime;
    log.debug('Session created', { durationMs: sessionCreateTime });

    // Track full content for actionable detection
    let fullContent = '';

    return createSSEResponse(
      async function* () {
        for await (const event of stream) {
          if (event.type === 'delta') {
            fullContent += event.content;
          }
          if (event.type === 'done') {
            fullContent = event.totalContent;
          }

          yield event;
        }
      },
      {
        onComplete: () => {
          const hasActionableItem = learningMode && detectActionableContent(fullContent);

          return {
            type: 'meta' as const,
            model,
            sessionCreateMs: sessionMetrics.sessionCreateMs,
            totalMs: nowMs() - startTime,
            firstDeltaMs: streamingMetrics.firstDeltaMs,
            sessionPoolHit: !sessionMetrics.createdNew,
            sessionPoolKey: sessionMetrics.poolKey,
            mcpEnabled: sessionMetrics.mcpEnabled,
            sessionReused: sessionMetrics.reusedConversation,
            activityEventId: streamingMetrics.activityEventId,
            threadId: threadId || null,
            learningMode,
            hasActionableItem,
          };
        },
        onError: (error) => {
          const errorMessage = error instanceof Error ? error.message : 'Stream error';
          log.error('Stream error', { errorMessage });
        },
        cleanup,
      }
    );
  } catch (error) {
    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to start stream';
    log.error(`Error after ${totalTime}ms`, { errorMessage });
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
