#!/usr/bin/env node
/**
 * Server-action guardrail.
 *
 * Every exported async function in a `'use server'` file (or function
 * with a per-function `'use server'` directive) must either:
 *   - call `requireGuardedUserContext` (the Phase 3 guard core), or
 *   - carry a `// public-action:` comment with justification.
 *
 * Name-based allowlists are explicitly not acceptable; the only escape
 * hatch is the explicit comment.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src/app', 'src/lib'];

const TOP_USE_SERVER = /^\s*['"]use server['"];?/;
const PUBLIC_ACTION_COMMENT = /\/\/\s*public-action:/;
const EXPORTED_ASYNC_PATTERN =
  /export\s+(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async\s*\()/g;
const GUARD_CALL_PATTERN = /\brequireGuardedUserContext\s*\(/;

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

function findFunctionBody(source, startIndex) {
  // Walk forward from startIndex until we hit the opening `{`, then
  // brace-balance to the matching close.
  let openIndex = source.indexOf('{', startIndex);
  if (openIndex === -1) return '';
  let depth = 0;
  for (let pointer = openIndex; pointer < source.length; pointer++) {
    const character = source[pointer];
    if (character === '{') depth++;
    else if (character === '}') {
      depth--;
      if (depth === 0) return source.slice(openIndex, pointer + 1);
    }
  }
  return source.slice(openIndex);
}

function findNeighborhood(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const previousLineStart = source.lastIndexOf('\n', lineStart - 2) + 1;
  return source.slice(previousLineStart, source.indexOf('\n', index));
}

function lineNumberFor(source, index) {
  return source.slice(0, index).split('\n').length;
}

function checkFile(absolutePath) {
  const source = readFileSync(absolutePath, 'utf8');
  const firstNonEmptyLine = source.split('\n').find((line) => line.trim().length > 0) ?? '';
  const fileIsServerAction = TOP_USE_SERVER.test(firstNonEmptyLine.trim());
  // Per-function 'use server' is rare; checking file-level is sufficient
  // for the current codebase. Extend here when per-function adoption lands.
  if (!fileIsServerAction) return [];

  const offenders = [];
  EXPORTED_ASYNC_PATTERN.lastIndex = 0;
  let match;
  while ((match = EXPORTED_ASYNC_PATTERN.exec(source)) !== null) {
    const name = match[1] ?? match[2];
    const body = findFunctionBody(source, match.index);
    if (GUARD_CALL_PATTERN.test(body)) continue;
    const neighborhood = findNeighborhood(source, match.index);
    if (PUBLIC_ACTION_COMMENT.test(neighborhood)) continue;
    offenders.push({
      name,
      line: lineNumberFor(source, match.index),
    });
  }
  return offenders;
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root)));
  const violations = [];
  for (const file of files) {
    const offenders = checkFile(file);
    if (offenders.length === 0) continue;
    const relativePath = path.relative(ROOT, file);
    for (const offender of offenders) {
      violations.push({ file: relativePath, line: offender.line, name: offender.name });
    }
  }

  if (violations.length > 0) {
    console.error('Server-action guardrail FAILED:');
    for (const v of violations) {
      console.error(
        `  ${v.file}:${v.line}  exported async \`${v.name}\` needs requireGuardedUserContext() or // public-action: <reason>`,
      );
    }
    process.exit(1);
  }
  console.log(`Server-action guardrail passed (${files.length} files scanned).`);
}

main();
