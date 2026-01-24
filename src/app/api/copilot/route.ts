/**
 * Copilot Chat API Route
 * POST /api/copilot
 *
 * Uses Copilot SDK (standard model) for conversational chat.
 * OPTIMIZED: Uses lightweight session without MCP tools for fast responses.
 * For GitHub exploration, set `useGitHubTools: true` in the request body.
 */

import { parseJsonBody } from '@/lib/api';
import { now, nowMs } from '@/lib/utils/date-utils';
import {
    type CopilotChatRequest,
    validateCopilotChatRequest,
} from '@/lib/copilot/api-requests';
import { createLoggedChatSession, createLoggedGitHubChatSession } from '@/lib/copilot/server';
import { logger } from '@/lib/logger';
import { needsGitHubTools } from '@/lib/utils/content-detection';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Copilot API');

export async function POST(request: NextRequest) {
  const startTime = nowMs();
  
  try {
    const parseResult = await parseJsonBody<CopilotChatRequest>(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error }, { status: 400 });
    }

    const validationError = validateCopilotChatRequest(parseResult.data);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { prompt, useGitHubTools, conversationId } = parseResult.data;

    // Auto-detect or explicit GitHub tools request
    const enableGitHub = useGitHubTools === true || needsGitHubTools(prompt);
    const sessionType = enableGitHub ? 'GitHub Chat' : 'Chat (fast)';
    
    log.info(`${sessionType} - ${enableGitHub ? 'with MCP' : 'lightweight'}`);

    // Create appropriate session type
    const loggedSession = enableGitHub
      ? await createLoggedGitHubChatSession(sessionType, prompt, conversationId)
      : await createLoggedChatSession(sessionType, prompt, conversationId);

    const result = await loggedSession.sendAndWait(prompt);
    
    // Fire-and-forget cleanup (don't block response)
    loggedSession.destroy();

    const totalTime = nowMs() - startTime;
    log.info(`Total: ${totalTime}ms`);

    return NextResponse.json({
      response: result.responseText,
      toolCalls: result.toolCalls.map(t => ({
        name: t.name,
        args: t.args,
        result: t.result,
        duration: t.endTime ? t.endTime - t.startTime : undefined,
      })),
      meta: {
        generatedAt: now(),
        model: loggedSession.model,
        toolsUsed: result.toolCalls.map(t => t.name),
        totalTimeMs: result.totalTimeMs,
        usedGitHubTools: enableGitHub,
        sessionCreateMs: loggedSession.sessionMetrics?.sessionCreateMs ?? null,
        sessionPoolHit: loggedSession.sessionMetrics ? !loggedSession.sessionMetrics.createdNew : null,
        mcpEnabled: loggedSession.sessionMetrics?.mcpEnabled ?? null,
        sessionReused: loggedSession.sessionMetrics?.reusedConversation ?? null,
      },
    });
  } catch (error) {
    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to process request';
    log.error(`Error after ${totalTime}ms:`, errorMessage);
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
