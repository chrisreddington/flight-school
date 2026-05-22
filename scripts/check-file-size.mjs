import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const NEW_FILE_LIMIT = 400;

const FILE_LIMITS = {
  'src/app/api/jobs/job-executors.ts': 17,
  'src/app/api/jobs/executors/chat.ts': 200,
  'src/app/api/jobs/executors/evaluation.ts': 203,
  'src/app/api/jobs/executors/job-identity.ts': 67,
  'src/app/api/jobs/executors/progress.ts': 74,
  'src/app/api/jobs/executors/regeneration.ts': 242,
  'src/app/api/jobs/executors/session-registry.ts': 21,
  'src/app/api/jobs/executors/thread-consolidation.ts': 69,
  'src/lib/focus/storage.ts': 881,
  'src/components/LearningHistory/index.tsx': 740,
  'src/lib/auth/token-store.ts': 712,
  'src/lib/operations/active-operations.ts': 664,
  'src/hooks/use-challenge-sandbox.ts': 628,
  'src/components/ChallengeSandbox/ChallengeSandbox.tsx': 609,
  'src/hooks/use-learning-chat.ts': 573,
  'src/hooks/use-ai-focus.ts': 558,
};

function isProductionTypeScript(relativePath) {
  if (!relativePath.startsWith('src/')) return false;
  if (!/\.(ts|tsx)$/.test(relativePath)) return false;
  return !/\.(test|fixture)\.(ts|tsx)$/.test(relativePath);
}

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

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const failures = [];
const productionFiles = walk('src').filter(isProductionTypeScript);
const productionFileSet = new Set(productionFiles);
const addedProductionFiles = new Set([
  ...gitLines(['diff', '--name-only', '--diff-filter=A', '--', 'src']),
  ...gitLines(['ls-files', '--others', '--exclude-standard', '--', 'src']),
].filter(isProductionTypeScript));

for (const [relativePath, limit] of Object.entries(FILE_LIMITS)) {
  if (!productionFileSet.has(relativePath)) continue;

  const current = lineCount(relativePath);
  console.log(`${relativePath}: ${current}/${limit}`);

  if (current > limit) {
    failures.push(`${relativePath} has ${current} lines, limit is ${limit}`);
  }
}

for (const relativePath of addedProductionFiles) {
  if (Object.hasOwn(FILE_LIMITS, relativePath)) continue;

  const current = lineCount(relativePath);
  if (current > NEW_FILE_LIMIT) {
    failures.push(
      `${relativePath} has ${current} lines and is not in FILE_LIMITS; add an explicit ratchet or split it below ${NEW_FILE_LIMIT} lines`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
