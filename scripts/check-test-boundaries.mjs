#!/usr/bin/env node
/**
 * Test-boundary guardrail.
 *
 * Tests in this repo must assert on observable behaviour (return values,
 * `result.current`, response bodies, audit-log entries) — not on whether a
 * mocked-out application module was called. The skill at
 * `.github/skills/tests-that-respect-boundaries/SKILL.md` is the contract.
 *
 * Heuristic: count occurrences of `toHaveBeenCalled` matchers in each test
 * file. A one-time `.test-boundary-baseline.json` grandfathers today's
 * counts; the script fails if a file's count grows above its baseline, or
 * if a non-baselined file outside the allowlist contains any
 * `toHaveBeenCalled*` matcher.
 *
 * Allowlisted paths (system-seam assertions allowed):
 *   - src/test/integration/**   (multi-tenant + leak tests)
 *   - src/lib/security/**       (rate-limit, audit, guard primitives)
 *   - src/lib/auth/**           (token store, OAuth callbacks)
 *
 * Baseline schema:
 *   { "<relativePath>": <count>, ... }
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, '.test-boundary-baseline.json');
const ALLOWLIST_PREFIXES = ['src/test/integration/', 'src/lib/security/', 'src/lib/auth/'];

function walk(dir) {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(relativePath);
    return [relativePath.replaceAll(path.sep, '/')];
  });
}

function isTestFile(relativePath) {
  return /\.test\.(ts|tsx)$/.test(relativePath);
}

function isAllowlisted(relativePath) {
  return ALLOWLIST_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function countBoundaryViolations(relativePath) {
  const content = readFileSync(path.join(ROOT, relativePath), 'utf8');
  const matches = content.match(/\btoHaveBeenCalled(?:Times|With|TimesWith|Once|OnceWith)?\b/g);
  return matches ? matches.length : 0;
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

const failures = [];
const tests = walk('src').filter(isTestFile);

for (const relativePath of tests) {
  if (isAllowlisted(relativePath)) continue;

  const current = countBoundaryViolations(relativePath);
  const baselined = baseline[relativePath];

  if (baselined !== undefined) {
    if (current > baselined) {
      failures.push(
        `${relativePath} grew from baseline ${baselined} → ${current} ` +
          `toHaveBeenCalled* matchers. Replace mock-call assertions with ` +
          `behavioural ones (see tests-that-respect-boundaries skill).`,
      );
    }
    continue;
  }

  if (current > 0) {
    failures.push(
      `${relativePath} contains ${current} toHaveBeenCalled* matcher(s) but ` +
        `is not allowlisted or baselined. Assert on observable behaviour ` +
        `(return value / result.current / response body) instead, or — if ` +
        `the test is a tenant-isolation or system-seam assertion — move it ` +
        `under src/test/integration/.`,
    );
  }
}

if (failures.length > 0) {
  console.error('Test-boundary guardrail failed:\n');
  console.error(failures.map((line) => `  - ${line}`).join('\n'));
  process.exit(1);
}

console.log(
  `Test-boundary guardrail passed (${tests.length} test files scanned, ` +
    `${Object.keys(baseline).length} baselined).`,
);
