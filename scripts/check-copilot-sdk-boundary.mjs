#!/usr/bin/env node
/**
 * Copilot SDK worker-boundary guardrail.
 *
 * Enforces the rule documented in
 * `.github/skills/copilot-sdk-worker-only/SKILL.md`:
 *
 *   1. `@github/copilot-sdk` may only be imported from `src/worker/**`
 *      or `src/lib/copilot/runtime/**`.
 *   2. The session factories that wrap the SDK — `createLoggedCoachSession`,
 *      `createLoggedLightweightCoachSession`, `createSession`,
 *      `createSessionWithMetrics`, `wrapSessionWithLogging` — may only be
 *      imported by worker-internal modules (see WORKER_INTERNAL_PREFIXES).
 *
 * There is no name-based allowlist and no escape-hatch comment. If you
 * need to add a new AI capability, add the worker dispatch primitive
 * to `src/lib/copilot/execution/` and import THAT from Web/API.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src'];

// Catches both `import ... from '@github/copilot-sdk'` and dynamic type
// references like `import('@github/copilot-sdk').CopilotSession`. The
// boundary applies equally to type-only references, so type-erased SDK
// types do not leak into Web/API surface modules.
const SDK_IMPORT_PATTERN = /['"]@github\/copilot-sdk['"]/;

const FACTORY_NAMES = [
  'createLoggedCoachSession',
  'createLoggedLightweightCoachSession',
  'createSession',
  'createSessionWithMetrics',
  'wrapSessionWithLogging',
  'getConversationSession',
  'createGenericStreamingSession',
  'createEvaluationStreamingSession',
];
const FACTORY_IMPORT_PATTERN = new RegExp(
  `import\\s*(?:type\\s*)?{[^}]*\\b(${FACTORY_NAMES.join('|')})\\b[^}]*}\\s*from\\s*['"]([^'\"]+)['"]`,
  'g',
);

const SDK_ALLOWED_PREFIXES = ['src/worker/', 'src/lib/copilot/runtime/'];

// SDK adapter modules that legitimately wrap `@github/copilot-sdk` for
// worker-internal use. These are imported only by the runtime and the
// server-side factories (server.ts), both of which are themselves
// gated by the factory-import allowlist below. Web/API code must NEVER
// import from these files directly — use `executeCopilotChat` /
// `executeCopilotCoachJob` from `src/lib/copilot/execution/` instead.
const SDK_ALLOWED_FILES = new Set([
  'src/lib/copilot/sessions.ts',
  'src/lib/copilot/logged-session.ts',
  'src/lib/copilot/mcp.ts',
  'src/lib/copilot/capabilities.ts',
]);

// Factory imports are allowed only in worker-runtime modules and the
// internal worker API routes. `src/lib/copilot/execution/` is the public
// dispatch API consumed by Web/API and intentionally NOT on this list:
// the dispatchers there speak HTTP/IPC to the worker, never the SDK.
const WORKER_INTERNAL_PREFIXES = ['src/worker/', 'src/lib/copilot/runtime/'];

// SDK adapter / session-factory modules. These files legitimately wrap
// the SDK or its session factories for worker-internal use, and they
// are themselves imported only by the runtime, worker executors, or
// worker-internal API routes. Adding to this set is a code-review red
// flag — the file should normally move into `src/worker/` instead.
const WORKER_INTERNAL_FILES = new Set([
  'src/lib/copilot/server.ts',
  'src/lib/copilot/sessions.ts',
  'src/lib/copilot/logged-session.ts',
  'src/lib/copilot/streaming.ts',
  'src/lib/copilot/streaming-session.ts',
  'src/lib/challenge/authoring/authoring-session.ts',
]);

function walk(absoluteDir) {
  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return [];
    return [absolutePath];
  });
}

function relativeFromRoot(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

function isUnderPrefix(relativePath, prefixes) {
  return prefixes.some((prefix) => relativePath.startsWith(prefix));
}

const violations = [];

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const relativePath = relativeFromRoot(file);
    const source = readFileSync(file, 'utf8');

    if (
      SDK_IMPORT_PATTERN.test(source) &&
      !isUnderPrefix(relativePath, SDK_ALLOWED_PREFIXES) &&
      !SDK_ALLOWED_FILES.has(relativePath)
    ) {
      violations.push(
        `${relativePath}: imports @github/copilot-sdk directly. Only ${SDK_ALLOWED_PREFIXES.join(' or ')} (or SDK_ALLOWED_FILES) may.`,
      );
    }

    let match;
    FACTORY_IMPORT_PATTERN.lastIndex = 0;
    while ((match = FACTORY_IMPORT_PATTERN.exec(source)) !== null) {
      const factoryName = match[1];
      if (!isUnderPrefix(relativePath, WORKER_INTERNAL_PREFIXES) && !WORKER_INTERNAL_FILES.has(relativePath)) {
        violations.push(
          `${relativePath}: imports '${factoryName}' from a non-worker module. Route this through @/lib/copilot/execution instead.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Copilot SDK worker-boundary violations:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  console.error('');
  console.error('See .github/skills/copilot-sdk-worker-only/SKILL.md for the contract.');
  process.exit(1);
}

console.log('check-copilot-sdk-boundary: no violations detected.');
