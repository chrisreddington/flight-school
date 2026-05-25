/** Handler for `POST /api/internal/copilot/execute`. */

import { parseJsonBody } from '@/lib/api/request-utils';
import { parseCopilotWorkerChatRequest } from '@/lib/copilot/execution/protocol';
import { executeCopilotChatInWorkerRuntime } from '@/lib/copilot/runtime/worker-executor';

export async function handleCopilotExecute(request: Request): Promise<Response> {
  const parseResult = await parseJsonBody<unknown>(request);
  if (!parseResult.success) {
    return Response.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  let workerRequest;
  try {
    workerRequest = parseCopilotWorkerChatRequest(parseResult.data);
  } catch {
    return Response.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  try {
    const result = await executeCopilotChatInWorkerRuntime(workerRequest);
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Worker execution failed' }, { status: 500 });
  }
}
