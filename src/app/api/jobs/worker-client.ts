import { getCopilotWorkerConfig } from '@/lib/copilot/execution/config';
import type { DispatchJobExecutionToWorkerRequest } from '@/lib/jobs/dispatch';
import {
  mergeTracePropagationHeaders,
  type TracePropagationHeaders,
} from '@/lib/observability/context-propagation';

function getRequiredWorkerConfig() {
  const config = getCopilotWorkerConfig();
  if (!config) {
    throw new Error('Copilot worker is required for background job execution');
  }
  return config;
}

export async function dispatchJobExecutionToWorker(
  request: DispatchJobExecutionToWorkerRequest,
): Promise<void> {
  const config = getRequiredWorkerConfig();
  const { traceContext, ...dispatchRequest } = request;
  const headers = mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${config.secret}`,
      'content-type': 'application/json',
    },
    traceContext ?? {},
  );

  const response = await fetch(`${config.baseUrl}/api/internal/jobs/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify(dispatchRequest),
  });

  if (!response.ok) {
    throw new Error(`Copilot worker job dispatch failed with HTTP ${response.status}`);
  }
}

export async function cancelWorkerJob(
  jobId: string,
  traceContext?: TracePropagationHeaders,
): Promise<void> {
  const config = getRequiredWorkerConfig();
  const headers = mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${config.secret}`,
      'content-type': 'application/json',
    },
    traceContext ?? {},
  );

  const response = await fetch(`${config.baseUrl}/api/internal/jobs/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jobId }),
  });

  if (!response.ok) {
    throw new Error(`Copilot worker job cancel failed with HTTP ${response.status}`);
  }
}
