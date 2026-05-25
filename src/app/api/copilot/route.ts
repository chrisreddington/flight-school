/**
 * Copilot Chat API Route
 * POST /api/copilot
 *
 * Uses Copilot SDK (standard model) for conversational chat.
 * The caller selects a base chat profile (`'chat'`, `'learning'`,
 * `'coach'`, …) and optionally a `capabilities` selection (`'auto'` to
 * let the server elevate, or an explicit `CapabilityId[]`). Capability
 * selection is validated against the profile's allowlist before
 * dispatch.
 */

import { parseJsonBody } from '@/lib/api';
import { nowMs } from '@/lib/utils/date-utils';
import { type CopilotChatRequest, validateCopilotChatRequest } from '@/lib/copilot/api-requests';
import { executeCopilotChat } from '@/lib/copilot/execution';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import { logger } from '@/lib/logger';
import { withGuardedRoute } from '@/lib/security/guard';
import { CHAT_GUARD } from '@/lib/security/route-defaults';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Copilot API');

// Long-running AI chat: extend timeout beyond Vercel/Node default.
export const maxDuration = 300;

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

    const { prompt, profile, capabilities, conversationId } = parseResult.data;

    return await withGuardedRoute(
      {
        ...CHAT_GUARD,
        eventType: 'copilot.session.create',
        auditMetadata: { route: '/api/copilot' },
      },
      async (ctx) => {
        const identity = createSessionIdentity(ctx);
        const result = await executeCopilotChat({
          identity,
          prompt,
          profile,
          capabilities,
          conversationId,
        });

        const totalTime = nowMs() - startTime;
        log.info(`Total: ${totalTime}ms`);

        return NextResponse.json(result);
      },
    );
  } catch (error) {
    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to process request';
    log.error(`Error after ${totalTime}ms:`, errorMessage);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
