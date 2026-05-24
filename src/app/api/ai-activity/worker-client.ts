import { workerFetch } from '@/lib/copilot/execution/worker-fetch';
import type { TracePropagationHeaders } from '@/lib/observability/context-propagation';

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
  await workerFetch(
    '/api/internal/ai-activity',
    { method: 'DELETE', headers: { 'x-user-id': userId } },
    { errorContext: 'activity delete', traceContext },
  );
}
