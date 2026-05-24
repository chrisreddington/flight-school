#!/usr/bin/env node
/**
 * Cache-key scope guardrail.
 *
 * Every `'use cache'` directive, `cacheTag()`, `revalidateTag()`, and
 * `updateTag()` call must use a tag string that is either:
 *   - prefixed with `public:` (data is safe to share across tenants), or
 *   - includes an interpolated tenant scope (`user:${...}` minimum).
 *
 * Per `docs/architecture-multitenant.md`, per-user GitHub data is never
 * `public:`. The PR description must justify any `public:` tag.
 *
 * Heuristic: AST-light regex sweep over .ts/.tsx files under src/. We
 * scan for the tag-producing API calls and string-literal directives,
 * extracting their primary argument; any literal that fails the rule
 * fails the build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src'];

const TAG_API_PATTERN =
  /\b(?:cacheTag|revalidateTag|updateTag)\s*\(\s*(['"`])([^'"`\n]+)\1/g;

const USE_CACHE_DIRECTIVE_PATTERN = /(^|\n)\s*['"`]use cache['"`]\s*;?/g;

const PUBLIC_PREFIX = 'public:';
const TENANT_SCOPE_PATTERN = /\$\{[^}]*\b(userId|sessionId|installationId|owner)\b[^}]*\}/;

function walk(absoluteDir) {
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    if (entry.name === 'node_modules') return [];
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return [];
    return [absolutePath];
  });
}

function isTenantScoped(tag) {
  if (tag.startsWith(PUBLIC_PREFIX)) return true;
  return TENANT_SCOPE_PATTERN.test(tag);
}

function checkFile(absolutePath) {
  const source = readFileSync(absolutePath, 'utf8');
  const offenders = [];
  TAG_API_PATTERN.lastIndex = 0;
  let match;
  while ((match = TAG_API_PATTERN.exec(source)) !== null) {
    const tag = match[2];
    if (!isTenantScoped(tag)) {
      offenders.push({ tag, index: match.index, kind: 'tag' });
    }
  }

  // A `'use cache'` directive caches the enclosing scope's return value.
  // It MUST be accompanied by at least one tenant-scoped cacheTag() in the
  // same file (or a `public:` tag) so the cache entry is keyed per tenant.
  USE_CACHE_DIRECTIVE_PATTERN.lastIndex = 0;
  let directiveMatch;
  while ((directiveMatch = USE_CACHE_DIRECTIVE_PATTERN.exec(source)) !== null) {
    const hasScopedTag = /cacheTag\s*\(\s*['"`](?:public:|[^'"`\n]*\$\{[^}]*\b(?:userId|sessionId|installationId|owner)\b[^}]*\})/.test(
      source,
    );
    if (!hasScopedTag) {
      offenders.push({
        tag: "'use cache' directive without a tenant-scoped cacheTag()",
        index: directiveMatch.index,
        kind: 'directive',
      });
    }
  }

  return offenders;
}

function lineNumberFor(source, index) {
  return source.slice(0, index).split('\n').length;
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => {
    const absoluteRoot = path.join(ROOT, root);
    try {
      statSync(absoluteRoot);
    } catch {
      return [];
    }
    return walk(absoluteRoot);
  });

  const violations = [];
  for (const file of files) {
    const offenders = checkFile(file);
    if (offenders.length === 0) continue;
    const source = readFileSync(file, 'utf8');
    const relativePath = path.relative(ROOT, file);
    for (const offender of offenders) {
      violations.push({
        file: relativePath,
        line: lineNumberFor(source, offender.index),
        tag: offender.tag,
      });
    }
  }

  if (violations.length > 0) {
    console.error('Cache-key scope guardrail FAILED:');
    for (const v of violations) {
      console.error(
        `  ${v.file}:${v.line}  tag="${v.tag}" — needs tenant scope (user:/sessionId/installationId/owner) or "public:" prefix`,
      );
    }
    console.error(
      '\nRule: every cacheTag/revalidateTag/updateTag literal must either be\n' +
      'tenant-scoped (interpolated userId/sessionId/installationId/owner) or\n' +
      'prefixed `public:` with PR-description justification.',
    );
    process.exit(1);
  }

  console.log(`Cache-key scope guardrail passed (${files.length} files scanned).`);
}

main();
