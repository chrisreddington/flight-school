import { createLoggedCoachSession } from '@/lib/copilot/server';
import type {
  CopilotCoachJobRequest,
  CopilotCoachJobResult,
  CopilotToolCallRecord,
} from '@/lib/copilot/execution/types';
import { now } from '@/lib/utils/date-utils';

/**
 * Run a one-shot coach generation inside the worker runtime.
 *
 * Capability selection is orthogonal to the profile: `variant: 'coach'`
 * grounds the model in MCP tools, `variant: 'lightweight'` skips MCP
 * for the fast path. Sessions are always destroyed in `finally` so an
 * SDK error never leaks a live session into the runtime pool.
 */
export async function executeCoachJobInRuntime(
  request: CopilotCoachJobRequest,
): Promise<CopilotCoachJobResult> {
  const inputPrompt = request.inputSummary ?? request.prompt;
  const capabilities = request.variant === 'coach' ? (['github'] as const) : ([] as const);
  const loggedSession = await createLoggedCoachSession(
    request.identity,
    request.operationName,
    inputPrompt,
    capabilities,
  );

  try {
    const result = await loggedSession.sendAndWait(request.prompt);
    return {
      response: result.responseText,
      toolCalls: result.toolCalls.map(toToolCallRecord),
      meta: {
        generatedAt: now(),
        model: loggedSession.model,
        operationName: request.operationName,
        variant: request.variant,
        totalTimeMs: result.totalTimeMs,
        sessionCreateMs: loggedSession.sessionMetrics?.sessionCreateMs ?? null,
        mcpEnabled: request.variant === 'coach',
      },
    };
  } finally {
    await loggedSession.destroy();
  }
}

function toToolCallRecord(toolCall: {
  name: string;
  args: unknown;
  result: string;
  startTime: number;
  endTime?: number;
}): CopilotToolCallRecord {
  return {
    name: toolCall.name,
    args: toolCall.args,
    result: toolCall.result,
    duration: toolCall.endTime ? toolCall.endTime - toolCall.startTime : undefined,
  };
}
