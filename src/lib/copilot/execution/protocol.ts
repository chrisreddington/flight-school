import type {
  CopilotChatExecutionRequest,
  CopilotChatExecutionResult,
  CopilotCoachJobRequest,
  CopilotCoachJobResult,
  CopilotCoachVariant,
  CopilotToolCallRecord,
} from './types';

type UnknownRecord = Record<string, unknown>;

export function parseCopilotWorkerChatRequest(value: unknown): CopilotChatExecutionRequest {
  const record = requireRecord(value, 'request');
  const identity = requireRecord(record.identity, 'identity');

  return {
    identity: {
      userId: requireString(identity.userId, 'identity.userId'),
      gitHubToken: requireString(identity.gitHubToken, 'identity.gitHubToken'),
    },
    prompt: requireString(record.prompt, 'prompt'),
    useGitHubTools: optionalBoolean(record.useGitHubTools, 'useGitHubTools'),
    conversationId: optionalString(record.conversationId, 'conversationId'),
  };
}

export function parseCopilotWorkerChatResult(value: unknown): CopilotChatExecutionResult {
  const record = requireRecord(value, 'result');
  const meta = requireRecord(record.meta, 'meta');

  return {
    response: requireString(record.response, 'response'),
    toolCalls: requireToolCalls(record.toolCalls),
    meta: {
      generatedAt: requireString(meta.generatedAt, 'meta.generatedAt'),
      model: requireString(meta.model, 'meta.model'),
      toolsUsed: requireStringArray(meta.toolsUsed, 'meta.toolsUsed'),
      totalTimeMs: requireNumber(meta.totalTimeMs, 'meta.totalTimeMs'),
      usedGitHubTools: requireBoolean(meta.usedGitHubTools, 'meta.usedGitHubTools'),
      sessionCreateMs: nullableNumber(meta.sessionCreateMs, 'meta.sessionCreateMs'),
      sessionPoolHit: nullableBoolean(meta.sessionPoolHit, 'meta.sessionPoolHit'),
      mcpEnabled: nullableBoolean(meta.mcpEnabled, 'meta.mcpEnabled'),
      sessionReused: nullableBoolean(meta.sessionReused, 'meta.sessionReused'),
    },
  };
}

export function parseCopilotWorkerCoachRequest(value: unknown): CopilotCoachJobRequest {
  const record = requireRecord(value, 'request');
  const identity = requireRecord(record.identity, 'identity');

  return {
    identity: {
      userId: requireString(identity.userId, 'identity.userId'),
      gitHubToken: requireString(identity.gitHubToken, 'identity.gitHubToken'),
    },
    variant: requireVariant(record.variant),
    operationName: requireString(record.operationName, 'operationName'),
    prompt: requireString(record.prompt, 'prompt'),
    inputSummary: optionalString(record.inputSummary, 'inputSummary'),
  };
}

export function parseCopilotWorkerCoachResult(value: unknown): CopilotCoachJobResult {
  const record = requireRecord(value, 'result');
  const meta = requireRecord(record.meta, 'meta');

  return {
    response: requireString(record.response, 'response'),
    toolCalls: requireToolCalls(record.toolCalls),
    meta: {
      generatedAt: requireString(meta.generatedAt, 'meta.generatedAt'),
      model: requireString(meta.model, 'meta.model'),
      operationName: requireString(meta.operationName, 'meta.operationName'),
      variant: requireVariant(meta.variant),
      totalTimeMs: requireNumber(meta.totalTimeMs, 'meta.totalTimeMs'),
      sessionCreateMs: nullableNumber(meta.sessionCreateMs, 'meta.sessionCreateMs'),
      mcpEnabled: requireBoolean(meta.mcpEnabled, 'meta.mcpEnabled'),
    },
  };
}

function requireVariant(value: unknown): CopilotCoachVariant {
  if (value === 'lightweight' || value === 'coach') return value;
  throw new Error(`variant must be 'lightweight' or 'coach'`);
}

function requireRecord(value: unknown, name: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} is required`);
  }
  return value as UnknownRecord;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requireBoolean(value, name);
}

function nullableBoolean(value: unknown, name: string): boolean | null {
  if (value === null) return null;
  return requireBoolean(value, name);
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function nullableNumber(value: unknown, name: string): number | null {
  if (value === null) return null;
  return requireNumber(value, name);
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be a string array`);
  }
  return value;
}

function requireToolCalls(value: unknown): CopilotToolCallRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('toolCalls must be an array');
  }
  return value.map((item, index) => {
    const record = requireRecord(item, `toolCalls[${index}]`);
    const duration = record.duration === undefined
      ? undefined
      : requireNumber(record.duration, `toolCalls[${index}].duration`);
    return {
      name: requireString(record.name, `toolCalls[${index}].name`),
      args: record.args,
      result: requireString(record.result, `toolCalls[${index}].result`),
      duration,
    };
  });
}
