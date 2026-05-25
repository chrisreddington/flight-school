/** Handler for `POST /api/internal/copilot/coach`. */

import { parseJsonBody } from '@/lib/api/request-utils';
import { parseCopilotWorkerCoachRequest } from '@/lib/copilot/execution/protocol';
import { executeCopilotCoachJobInWorkerRuntime } from '@/lib/copilot/runtime/worker-executor';

export async function handleCopilotCoach(request: Request): Promise<Response> {
  const parseResult = await parseJsonBody<unknown>(request);
  if (!parseResult.success) {
    return Response.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  let workerRequest;
  try {
    workerRequest = parseCopilotWorkerCoachRequest(parseResult.data);
  } catch {
    return Response.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  try {
    const result = await executeCopilotCoachJobInWorkerRuntime(workerRequest);
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Worker execution failed' }, { status: 500 });
  }
}
