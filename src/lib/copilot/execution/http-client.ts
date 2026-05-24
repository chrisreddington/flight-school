import type {
  CopilotChatExecutionRequest,
  CopilotChatExecutionResult,
  CopilotCoachJobRequest,
  CopilotCoachJobResult,
} from './types';
import type { CopilotWorkerConfig } from './config';
import {
  parseCopilotWorkerChatResult,
  parseCopilotWorkerCoachResult,
} from './protocol';

const WORKER_CHAT_PATH = '/api/internal/copilot/execute';
const WORKER_COACH_PATH = '/api/internal/copilot/coach';
const WORKER_AUTHORING_PATH = '/api/internal/copilot/authoring';

interface ExecuteViaWorkerOptions {
  signal?: AbortSignal;
}

export async function executeCopilotChatViaWorker(
  config: CopilotWorkerConfig,
  request: CopilotChatExecutionRequest,
  options: ExecuteViaWorkerOptions = {},
): Promise<CopilotChatExecutionResult> {
  return postToWorker(config, WORKER_CHAT_PATH, request, parseCopilotWorkerChatResult, options);
}

export async function executeCopilotCoachJobViaWorker(
  config: CopilotWorkerConfig,
  request: CopilotCoachJobRequest,
  options: ExecuteViaWorkerOptions = {},
): Promise<CopilotCoachJobResult> {
  return postToWorker(config, WORKER_COACH_PATH, request, parseCopilotWorkerCoachResult, options);
}

/**
 * Open an NDJSON stream from the worker authoring endpoint.
 *
 * Returns the raw `Response` so the caller can pipe the body straight
 * back to the client without parsing or copying every chunk.
 */
export async function openCopilotAuthoringStream(
  config: CopilotWorkerConfig,
  body: unknown,
  options: ExecuteViaWorkerOptions = {},
): Promise<Response> {
  const response = await fetch(`${config.baseUrl}${WORKER_AUTHORING_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Copilot worker authoring stream failed: HTTP ${response.status}`);
  }
  return response;
}

async function postToWorker<TResult>(
  config: CopilotWorkerConfig,
  path: string,
  body: unknown,
  parseResult: (value: unknown) => TResult,
  options: ExecuteViaWorkerOptions,
): Promise<TResult> {
  const abort = createWorkerAbortController(config.timeoutMs, options.signal);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

    if (!response.ok) {
      throw new Error(`Copilot worker returned HTTP ${response.status}: ${await readWorkerError(response)}`);
    }

    return parseResult(await response.json());
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
