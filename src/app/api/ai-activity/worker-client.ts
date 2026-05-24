import { getCopilotWorkerConfig } from '@/lib/copilot/execution/config';
import {
  mergeTracePropagationHeaders,
  type TracePropagationHeaders,
} from '@/lib/observability/context-propagation';

function getRequiredWorkerConfig() {
  const config = getCopilotWorkerConfig();
  if (!config) {
    throw new Error('Copilot worker is required for activity operations');
  }
  return config;
}

/**
 * Wipe all activity events owned by `userId` on the worker (in-memory
 * ring + durable file). Used by `/api/user/data` to honour the GDPR
 * delete-all path. Throws on transport / non-OK responses so the
 * caller can record a partial failure.
 */
export async function deleteWorkerActivityForUser(
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<void> {
  const config = getRequiredWorkerConfig();
  const headers = mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${config.secret}`,
      'x-user-id': userId,
    },
    traceContext ?? {},
  );
  const response = await fetch(`${config.baseUrl}/api/internal/ai-activity`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    throw new Error(`Copilot worker activity delete failed with HTTP ${response.status}`);
  }
}
