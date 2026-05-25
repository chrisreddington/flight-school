import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const LIMITED_EXPORT_FILES = [
  'src/lib/auth/token-store.ts',
  'src/lib/copilot/server.ts',
  'src/lib/copilot/sessions.ts',
  'src/lib/jobs/index.ts',
  'src/lib/threads/index.ts',
  'src/lib/workspace/index.ts',
];

const ALLOWED_EXPORTS: Record<string, string[]> = {
  'src/lib/auth/token-store.ts': [
    'StoredToken',
    'InMemoryTokenStore',
    'CosmosTokenStore',
    'getTokenStore',
    'createDefaultTokenStore',
  ],
  'src/lib/copilot/server.ts': ['createLoggedCoachSession', 'wrapSessionWithLogging'],
  'src/lib/copilot/sessions.ts': [
    'CHAT_MODEL',
    'createSessionWithMetrics',
    'getConversationCapabilities',
    'getConversationSession',
    'SessionWithMetrics',
    'shutdownAllPools',
    'warmCopilotClient',
  ],
  'src/lib/jobs/index.ts': [
    'jobStorage',
    'TopicRegenerationInput',
    'TopicRegenerationResult',
    'ChallengeRegenerationInput',
    'ChallengeRegenerationResult',
    'GoalRegenerationInput',
    'GoalRegenerationResult',
    'ChatResponseInput',
    'ChatResponseResult',
    'ChallengeEvaluationInput',
    'ChallengeEvaluationResult',
  ],
  'src/lib/threads/index.ts': [
    'threadStore',
    'THREAD_DATA_CHANGED_EVENT',
    'notifyThreadDataChanged',
    'CreateThreadOptions',
    'Message',
    'RepoReference',
    'Thread',
    'ThreadContext',
    'ToolCallEvent',
  ],
  'src/lib/workspace/index.ts': [
    'workspaceStore',
    'createEmptyFile',
    'createWorkspaceFromTemplate',
    'getWorkspaceTemplate',
    'ChallengeWorkspace',
    'WorkspaceFile',
    'AUTO_SAVE_DELAY_MS',
    'CURRENT_WORKSPACE_SCHEMA_VERSION',
    'MAX_FILES_PER_WORKSPACE',
  ],
};

function exportedNames(source: string): string[] {
  const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();

  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        throw new Error('Wildcard exports are not allowed in guarded modules');
      }
      if (ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          names.add(specifier.name.text);
        }
      }
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.add(declaration.name.text);
        }
      }
      continue;
    }

    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }

  return [...names].sort();
}

describe('public module surface area', () => {
  it.each(LIMITED_EXPORT_FILES)('%s only exposes intentional exports', (relativePath) => {
    const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');

    expect(exportedNames(source)).toEqual([...ALLOWED_EXPORTS[relativePath]].sort());
  });
});
