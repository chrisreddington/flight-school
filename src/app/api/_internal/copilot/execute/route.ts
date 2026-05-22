import { parseJsonBody } from '@/lib/api/request-utils';
import { parseCopilotWorkerChatRequest } from '@/lib/copilot/execution/protocol';
import { executeCopilotChatInWorkerRuntime } from '@/lib/copilot/runtime/worker-executor';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  if (process.env.COPILOT_WORKER_ENABLED !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const secret = process.env.COPILOT_WORKER_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'COPILOT_WORKER_SECRET is not configured' }, { status: 500 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parseResult = await parseJsonBody<unknown>(request);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }

  let workerRequest;
  try {
    workerRequest = parseCopilotWorkerChatRequest(parseResult.data);
  } catch {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }

  try {
    const result = await executeCopilotChatInWorkerRuntime(workerRequest);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Worker execution failed' }, { status: 500 });
  }
}
