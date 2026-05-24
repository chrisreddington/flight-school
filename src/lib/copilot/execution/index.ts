import { getCopilotWorkerConfig } from './config';
import {
  executeCopilotChatViaWorker,
  executeCopilotCoachJobViaWorker,
  openCopilotAuthoringStream,
} from './http-client';
import type {
  CopilotChatExecutionRequest,
  CopilotChatExecutionResult,
  CopilotCoachJobRequest,
  CopilotCoachJobResult,
} from './types';
import { CopilotWorkerRequiredError } from './worker-required-error';

export async function executeCopilotChat(
  request: CopilotChatExecutionRequest,
): Promise<CopilotChatExecutionResult> {
  const workerConfig = requireWorker();
  return executeCopilotChatViaWorker(workerConfig, request);
}

/**
 * Dispatch a one-shot coach/lightweight Copilot generation to the worker.
 *
 * @remarks
 * Web/API and feature code never construct Copilot sessions in-process;
 * see `.github/skills/copilot-sdk-worker-only/SKILL.md`. Callers build a
 * prompt, hand it to this primitive, and parse the structured response.
 */
export async function executeCopilotCoachJob(
  request: CopilotCoachJobRequest,
): Promise<CopilotCoachJobResult> {
  const workerConfig = requireWorker();
  return executeCopilotCoachJobViaWorker(workerConfig, request);
}

function requireWorker() {
  const workerConfig = getCopilotWorkerConfig();
  if (!workerConfig) {
    throw new CopilotWorkerRequiredError();
  }
  return workerConfig;
}

/**
 * Open an NDJSON authoring stream from the worker. Callers are
 * responsible for piping/parsing the response body.
 */
export async function openCopilotAuthoringStreamViaWorker(
  body: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  const workerConfig = requireWorker();
  return openCopilotAuthoringStream(workerConfig, body, options);
}

export type {
  CopilotCoachJobRequest,
  CopilotCoachJobResult,
} from './types';
