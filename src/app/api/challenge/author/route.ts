/**
 * Challenge Authoring Streaming API Route
 * POST /api/challenge/author
 *
 * Thin proxy: authenticates the caller (rate limit + session cap + audit
 * via `withGuardedRoute`) and pipes an SSE stream from the worker's
 * `/api/internal/copilot/authoring` endpoint, which is the only place
 * that may construct an in-process Copilot SDK session.
 *
 * @see SPEC-006 for custom challenge authoring requirements
 * @see .github/skills/copilot-sdk-worker-only/SKILL.md
 */

import { parseJsonBody } from '@/lib/api';
import { openCopilotAuthoringStreamViaWorker } from '@/lib/copilot/execution';
import { CopilotEntitlementRequiredError } from '@/lib/copilot/entitlement';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import type { AuthoringContext } from '@/lib/challenge/authoring/types';
import { validateAuthoringRequest } from '@/lib/challenge/authoring/validation';
import { logger } from '@/lib/logger';
import { withGuardedRoute } from '@/lib/security/guard';
import { AUTHOR_GUARD } from '@/lib/security/route-defaults';
import { NextRequest } from 'next/server';

const log = logger.withTag('Author API');

export const maxDuration = 300;

interface AuthorRequest {
  prompt: string;
  conversationId?: string;
  context?: AuthoringContext;
  action?: 'clarify' | 'generate' | 'validate';
}

export async function POST(request: NextRequest) {
  const parseResult = await parseJsonBody<AuthorRequest>(request);
  if (!parseResult.success) {
    log.error(`Parse error: ${parseResult.error}`);
    return new Response(JSON.stringify({ error: parseResult.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const validationError = validateAuthoringRequest(parseResult.data);
  if (validationError) {
    log.error(`Validation error: ${validationError}`);
    return new Response(JSON.stringify({ error: validationError }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { prompt, conversationId, context, action } = parseResult.data;

  return await withGuardedRoute(
    {
      ...AUTHOR_GUARD,
      eventType: 'copilot.session.create',
      auditMetadata: {
        route: '/api/challenge/author',
        action: action || 'auto',
      },
    },
    async (userCtx) => {
      const identity = createSessionIdentity(userCtx);
      try {
        const workerResponse = await openCopilotAuthoringStreamViaWorker({
          identity,
          prompt,
          conversationId,
          context,
          action,
        });
        return new Response(workerResponse.body, {
          status: workerResponse.status,
          headers: {
            'content-type':
              workerResponse.headers.get('content-type') ?? 'text/event-stream',
            'cache-control': 'no-store, no-transform',
            connection: 'keep-alive',
          },
        });
      } catch (error) {
        if (error instanceof CopilotEntitlementRequiredError) {
          return new Response(JSON.stringify({ error: 'copilot_required' }), {
            status: 402,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const message = error instanceof Error ? error.message : 'Worker dispatch failed';
        log.error('Authoring proxy error:', message);
        const status = extractStatusFromMessage(message) ?? 500;
        return new Response(JSON.stringify({ error: errorForStatus(status, message) }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    },
  );
}

function extractStatusFromMessage(message: string): number | null {
  const match = message.match(/HTTP (\d{3})/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function errorForStatus(status: number, fallback: string): string {
  return status === 402 ? 'copilot_required' : fallback;
}
