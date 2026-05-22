import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';
import type { CopilotWorkerConfig } from './config';
import { parseCopilotWorkerChatResult } from './protocol';

const WORKER_CHAT_PATH = '/api/_internal/copilot/execute';

interface ExecuteViaWorkerOptions {
  signal?: AbortSignal;
}

export async function executeCopilotChatViaWorker(
  config: CopilotWorkerConfig,
  request: CopilotChatExecutionRequest,
  options: ExecuteViaWorkerOptions = {},
): Promise<CopilotChatExecutionResult> {
  const abort = createWorkerAbortController(config.timeoutMs, options.signal);

  try {
    const response = await fetch(`${config.baseUrl}${WORKER_CHAT_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: abort.signal,
    });

    if (!response.ok) {
      throw new Error(`Copilot worker returned HTTP ${response.status}: ${await readWorkerError(response)}`);
    }

    return parseCopilotWorkerChatResult(await response.json());
  } catch (error) {
    if (abort.timedOut() && isAbortError(error)) {
      throw new Error(`Copilot worker request timed out after ${config.timeoutMs}ms`);
    }
    if (options.signal?.aborted && isAbortError(error)) {
      throw new Error('Copilot worker request was aborted');
    }
    throw error;
  } finally {
    abort.dispose();
  }
}

function createWorkerAbortController(timeoutMs: number, callerSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

async function readWorkerError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.statusText || 'Worker request failed';

  try {
    const value = JSON.parse(text) as unknown;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const error = (value as Record<string, unknown>).error;
      if (typeof error === 'string' && error.trim().length > 0) {
        return error;
      }
    }
  } catch {
    return text;
  }

  return text;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
