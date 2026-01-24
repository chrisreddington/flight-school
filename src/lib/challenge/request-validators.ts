/**
 * Challenge request validation helpers.
 *
 * Centralizes repeated API request validation logic for challenge endpoints.
 */

const MAX_HINT_QUESTION_LENGTH = 1000;
const MAX_CODE_LENGTH = 50000;
const MAX_FILES_TOTAL_LENGTH = 100000;
const DIFFICULTY_VALUES = ['beginner', 'intermediate', 'advanced'] as const;

/**
 * Validates a challenge definition payload.
 */
function validateChallengeDefinition(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return 'challenge is required and must be an object';
  }

  const challenge = value as Record<string, unknown>;

  if (!challenge.title || typeof challenge.title !== 'string') {
    return 'challenge.title is required';
  }
  if (!challenge.description || typeof challenge.description !== 'string') {
    return 'challenge.description is required';
  }
  if (!challenge.language || typeof challenge.language !== 'string') {
    return 'challenge.language is required';
  }
  if (!challenge.difficulty || typeof challenge.difficulty !== 'string') {
    return 'challenge.difficulty is required';
  }
  if (!DIFFICULTY_VALUES.includes(challenge.difficulty as (typeof DIFFICULTY_VALUES)[number])) {
    return 'challenge.difficulty must be one of: beginner, intermediate, advanced';
  }

  return null;
}

/**
 * Validates workspace file inputs.
 */
function validateWorkspaceFiles(
  value: unknown,
  options: { required?: boolean; maxTotalSize?: number } = {}
): string | null {
  const required = options.required ?? true;
  const maxTotalSize = options.maxTotalSize;

  if (!Array.isArray(value)) {
    return required ? 'files is required and must be an array' : null;
  }

  let totalSize = 0;

  for (const file of value) {
    if (!file || typeof file !== 'object') {
      return 'Invalid file format';
    }
    const record = file as Record<string, unknown>;

    if (!record.name || typeof record.name !== 'string') {
      return 'Each file must have a name';
    }
    if (typeof record.content !== 'string') {
      return 'Each file must have content';
    }

    totalSize += record.content.length;
  }

  if (maxTotalSize && totalSize > maxTotalSize) {
    return `Total file content exceeds maximum size (${maxTotalSize} characters)`;
  }

  return null;
}

/**
 * Validates a hint request payload.
 */
export function validateHintRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body is required';
  }

  const req = body as Record<string, unknown>;
  const challengeError = validateChallengeDefinition(req.challenge);
  if (challengeError) return challengeError;

  if (!req.question || typeof req.question !== 'string') {
    return 'question is required';
  }
  if (req.question.length > MAX_HINT_QUESTION_LENGTH) {
    return `question exceeds maximum length (${MAX_HINT_QUESTION_LENGTH} characters)`;
  }

  if (typeof req.currentCode !== 'string') {
    return 'currentCode must be a string';
  }
  if (req.currentCode.length > MAX_CODE_LENGTH) {
    return `currentCode exceeds maximum length (${MAX_CODE_LENGTH} characters)`;
  }

  return null;
}

/**
 * Validates a solve request payload.
 */
export function validateSolveRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body is required';
  }

  const req = body as Record<string, unknown>;
  const challengeError = validateChallengeDefinition(req.challenge);
  if (challengeError) return challengeError;

  return validateWorkspaceFiles(req.files);
}

/**
 * Validates an evaluation request payload.
 */
export function validateEvaluateRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body is required';
  }

  const req = body as Record<string, unknown>;
  const challengeError = validateChallengeDefinition(req.challenge);
  if (challengeError) return challengeError;

  return validateWorkspaceFiles(req.files, { maxTotalSize: MAX_FILES_TOTAL_LENGTH });
}
