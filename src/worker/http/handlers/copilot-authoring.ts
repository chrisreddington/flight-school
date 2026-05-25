/**
 * Handler for `POST /api/internal/copilot/authoring`.
 *
 * Owns the in-process Copilot SDK session and emits the stream as SSE so
 * the public route can be a literal pipe.
 */

import { parseJsonBody } from '@/lib/api/request-utils';
import { createGenericStreamingSession } from '@/lib/challenge/authoring/authoring-session';
import { parseGeneratedChallenge } from '@/lib/challenge/authoring/challenge-parser';
import type { AuthoringContext } from '@/lib/challenge/authoring/types';
import { CopilotEntitlementRequiredError } from '@/lib/copilot/entitlement';
import { nowMs } from '@/lib/utils/date-utils';

interface AuthoringWorkerRequest {
  identity: { userId: string; gitHubToken: string };
  prompt: string;
  conversationId?: string;
  context?: AuthoringContext;
  action?: 'clarify' | 'generate' | 'validate';
}

function isAuthoringWorkerRequest(value: unknown): value is AuthoringWorkerRequest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const identity = record.identity as Record<string, unknown> | undefined;
  return (
    typeof record.prompt === 'string' &&
    record.prompt.length > 0 &&
    !!identity &&
    typeof identity.userId === 'string' &&
    typeof identity.gitHubToken === 'string'
  );
}

export async function handleCopilotAuthoring(request: Request): Promise<Response> {
  const parseResult = await parseJsonBody<AuthoringWorkerRequest>(request);
  if (!parseResult.success || !isAuthoringWorkerRequest(parseResult.data)) {
    return Response.json({ error: 'Invalid worker request' }, { status: 400 });
  }

  const body = parseResult.data;
  const startTime = nowMs();

  let sessionHandle;
  try {
    sessionHandle = await createGenericStreamingSession({
      prompt: body.prompt,
      conversationId: body.conversationId,
      context: body.context,
      action: body.action,
      identity: body.identity,
    });
  } catch (error) {
    if (error instanceof CopilotEntitlementRequiredError) {
      return Response.json({ error: 'copilot_required' }, { status: 402 });
    }
    const message = error instanceof Error ? error.message : 'Authoring session failed';
    return Response.json({ error: message }, { status: 500 });
  }

  const { stream, cleanup, model, newConversationId, streamingMetrics } = sessionHandle;
  const sessionCreateMs = nowMs() - startTime;

  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const writeEvent = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const writeDone = () => controller.enqueue(encoder.encode('data: [DONE]\n\n'));

      let fullContent = '';

      try {
        for await (const event of stream) {
          if (event.type === 'delta') {
            fullContent += event.content;
            writeEvent({ type: 'delta', content: event.content });
          } else if (event.type === 'done') {
            fullContent = event.totalContent;
          }
        }

        const parsedChallenge = parseGeneratedChallenge(fullContent);
        if (parsedChallenge) {
          writeEvent({ type: 'challenge', challenge: parsedChallenge });
        }

        writeEvent({
          type: 'meta',
          model,
          conversationId: newConversationId,
          sessionCreateMs,
          firstDeltaMs: streamingMetrics.firstDeltaMs,
          totalMs: nowMs() - startTime,
        });
        writeDone();
      } catch (error) {
        writeEvent({
          type: 'error',
          message: error instanceof Error ? error.message : 'Stream error',
        });
      } finally {
        cleanup();
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}
