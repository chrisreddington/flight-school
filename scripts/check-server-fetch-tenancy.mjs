#!/usr/bin/env node
/**
 * Server-fetch tenancy guardrail.
 *
 * When `cacheComponents` is enabled, Next.js's default fetch caching
 * means an unconfigured server-side `fetch()` can cross-pollute tenants.
 * Every server-side `fetch(` call site under `src/app/**` or `src/lib/**`
 * must do one of:
 *   - pass `cache: 'no-store'`
 *   - declare `next: { tags: [...] }` with a tenant-scoped or public tag
 *   - carry a `// public-cache:` comment on the call site justifying it
 *
 * This script catches the hole that check-cache-key-scope.mjs cannot
 * see: a fetch with no explicit caching directive at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src/app', 'src/lib'];

// Skip files that only run client-side; the rule is server-only.
const CLIENT_FILE_PATTERN = /^['"]use client['"];?/;

const FETCH_CALL_PATTERN = /\bfetch\s*\(/g;
const NEXT_TAGS_PATTERN = /next\s*:\s*\{[^}]*tags\s*:/;
const NO_STORE_PATTERN = /cache\s*:\s*['"`]no-store['"`]/;
const FORCE_CACHE_PATTERN = /cache\s*:\s*['"`]force-cache['"`]/;
const NON_GET_METHOD_PATTERN = /method\s*:\s*['"`](?:POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"`]/i;
const PUBLIC_CACHE_COMMENT = /\/\/\s*public-cache:/;

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

function findFetchCallContext(source, fetchIndex) {
  // Slice from the fetch( opening paren forward to its matching close.
  let depth = 0;
  let start = source.indexOf('(', fetchIndex);
  if (start === -1) return '';
  for (let pointer = start; pointer < source.length; pointer++) {
    const character = source[pointer];
    if (character === '(') depth++;
    else if (character === ')') {
      depth--;
      if (depth === 0) {
        return source.slice(start, pointer + 1);
      }
    }
  }
  return source.slice(start);
}

function findCommentNeighborhood(source, fetchIndex) {
  // Look at the line containing the fetch + the line above.
  const lineStart = source.lastIndexOf('\n', fetchIndex) + 1;
  const previousLineStart = source.lastIndexOf('\n', lineStart - 2) + 1;
  return source.slice(previousLineStart, source.indexOf('\n', fetchIndex));
}

function lineNumberFor(source, index) {
  return source.slice(0, index).split('\n').length;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) =>
      match.replace(/[^\n]/g, ' '),
    )
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) =>
      lead + match.slice(lead.length).replace(/[^\n]/g, ' '),
    );
}

function checkFile(absolutePath) {
  const rawSource = readFileSync(absolutePath, 'utf8');
  // Skip client components.
  const firstNonEmptyLine = rawSource.split('\n').find((line) => line.trim().length > 0) ?? '';
  if (CLIENT_FILE_PATTERN.test(firstNonEmptyLine.trim())) return [];
  const source = stripComments(rawSource);

  const offenders = [];
  FETCH_CALL_PATTERN.lastIndex = 0;
  let match;
  while ((match = FETCH_CALL_PATTERN.exec(source)) !== null) {
    const callContext = findFetchCallContext(source, match.index);
    if (NO_STORE_PATTERN.test(callContext)) continue;
    if (NEXT_TAGS_PATTERN.test(callContext)) continue;
    if (FORCE_CACHE_PATTERN.test(callContext)) continue;
    // Next only caches GET requests; non-GET methods are never cached
    // by the runtime so they cannot leak between tenants via the cache.
    if (NON_GET_METHOD_PATTERN.test(callContext)) continue;
    const neighborhood = findCommentNeighborhood(rawSource, match.index);
    if (PUBLIC_CACHE_COMMENT.test(neighborhood)) continue;
    offenders.push({ index: match.index });
  }
  return offenders.map((offender) => ({
    line: lineNumberFor(source, offender.index),
  }));
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root)));
  const violations = [];
  for (const file of files) {
    const offenders = checkFile(file);
    if (offenders.length === 0) continue;
    const relativePath = path.relative(ROOT, file);
    for (const offender of offenders) {
      violations.push({ file: relativePath, line: offender.line });
    }
  }

  if (violations.length > 0) {
    console.error('Server-fetch tenancy guardrail FAILED:');
    for (const v of violations) {
      console.error(
        `  ${v.file}:${v.line}  fetch() needs cache: 'no-store' | next.tags: [...] | // public-cache: <reason>`,
      );
    }
    process.exit(1);
  }
  console.log(`Server-fetch tenancy guardrail passed (${files.length} files scanned).`);
}

main();
