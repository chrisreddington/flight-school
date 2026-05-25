#!/usr/bin/env node
/**
 * File-size guardrail.
 *
 * Caps:
 *   - production .ts/.tsx files (excluding *.test.* and *.fixture.*):  450 LOC
 *   - test .ts/.tsx files (*.test.*):                                  500 LOC
 *
 * A one-time `.size-budget-baseline.json` at the repo root grandfathers
 * today's offenders by path. For any file in the baseline, the script
 * fails if the file's current LOC exceeds the baselined LOC (regression).
 * For any file NOT in the baseline, the script fails if it exceeds the
 * applicable cap.
 *
 * Baseline schema:
 *   { "production": { "<relativePath>": <loc>, ... },
 *     "test":       { "<relativePath>": <loc>, ... } }
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PRODUCTION_CAP = 450;
const TEST_CAP = 500;
const BASELINE_PATH = path.join(ROOT, '.size-budget-baseline.json');

function walk(dir) {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(relativePath);
    return [relativePath.replaceAll(path.sep, '/')];
  });
}

function lineCount(relativePath) {
  const content = readFileSync(path.join(ROOT, relativePath), 'utf8');
  if (content.length === 0) return 0;
  const lines = content.split(/\r?\n/).length;
  return content.endsWith('\n') ? lines - 1 : lines;
}

function classify(relativePath) {
  if (!/\.(ts|tsx)$/.test(relativePath)) return null;
  if (/\.fixture\.(ts|tsx)$/.test(relativePath)) return null;
  if (/\.test\.(ts|tsx)$/.test(relativePath)) return 'test';
  return 'production';
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { production: {}, test: {} };

const failures = [];
const files = walk('src');

for (const relativePath of files) {
  const kind = classify(relativePath);
  if (!kind) continue;

  const current = lineCount(relativePath);
  const cap = kind === 'test' ? TEST_CAP : PRODUCTION_CAP;
  const baselined = baseline[kind]?.[relativePath];

  if (baselined !== undefined) {
    if (current > baselined) {
      failures.push(
        `${relativePath} grew from baseline ${baselined} → ${current} LOC. ` +
        `Shrink it (do not raise the baseline).`,
      );
    }
    continue;
  }

  if (current > cap) {
    failures.push(
      `${relativePath} has ${current} LOC, ${kind} cap is ${cap}. ` +
      `Split the module or, if unavoidable, add it to .size-budget-baseline.json ` +
      `(every baseline entry must shrink toward the cap).`,
    );
  }
}

if (failures.length > 0) {
  console.error('File-size guardrail failed:\n');
  console.error(failures.map((line) => `  - ${line}`).join('\n'));
  process.exit(1);
}

console.log(
  `File-size guardrail passed (${files.length} src files scanned, ` +
  `${Object.keys(baseline.production).length} production + ` +
  `${Object.keys(baseline.test).length} test baselined).`,
);
