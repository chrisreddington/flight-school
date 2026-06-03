/**
 * Static guard: the tracks domain never reaches a SQLite or transaction
 * primitive through its transitive import graph.
 *
 * Every shipped tracks module is deliberately backend-neutral — it depends only
 * on the {@link UserScopedStore} contract so it runs unchanged on every storage
 * adapter. If any module ever transitively imported `sqlite-adapter.ts` (the
 * only home of `node:sqlite`, `DatabaseSync`, and `withTransaction`) or the
 * `factory.ts` that constructs it, the domain would couple to a concrete backend
 * and break that promise. A single-file string grep can't catch a leak
 * introduced two hops away, so this walks the TS-resolved import edges
 * recursively — following static imports, `export ... from`, `@/`-aliased
 * specifiers, AND dynamic `import(...)` / `require(...)` calls — and asserts the
 * forbidden modules are unreachable from EVERY shipped entry point (not just a
 * hand-picked pair). A negative control proves the walker actually detects a
 * leak when one exists.
 *
 * @module tracks/tracks-repo.import-guard.test
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.join(process.cwd(), 'src');
const TRACKS_DIR = path.join(SRC_ROOT, 'lib', 'tracks');

/**
 * Every shipped tracks module is an entry point: a leak in any one of them
 * breaks backend-neutrality. Test and harness files are excluded — the harness
 * legitimately imports concrete adapters to drive its parity matrix, and is in
 * fact used below as the negative control.
 */
function shippedTracksEntries(): string[] {
  return readdirSync(TRACKS_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.harness.ts'))
    .map((name) => path.join('src', 'lib', 'tracks', name));
}

/**
 * Modules that must never appear in the tracks import graph. `sqlite-adapter`
 * owns every `node:sqlite` / `DatabaseSync` / `withTransaction` reference;
 * `factory` is the only other module that imports `node:sqlite`.
 */
const FORBIDDEN_SUBSTRINGS = ['storage/document-store/sqlite-adapter', 'storage/document-store/factory'];

/**
 * Collect every module specifier a TypeScript source imports — static
 * `import` / `export ... from` declarations AND dynamic `import(...)` /
 * `require(...)` calls — keeping only repo-internal (`.`-relative or
 * `@/`-aliased) targets.
 */
function importedSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  const record = (text: string): void => {
    if (text.startsWith('.') || text.startsWith('@/')) specifiers.push(text);
  };

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) record(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const [firstArg] = node.arguments;
      if ((isDynamicImport || isRequire) && firstArg && ts.isStringLiteral(firstArg)) record(firstArg.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return specifiers;
}

/** Resolve a relative or `@/`-aliased specifier from `fromFile` to a `.ts` path. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.resolve(SRC_ROOT, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/** Walk the transitive import graph from `entry`, returning every reached file. */
function transitiveImports(entry: string): Set<string> {
  const reached = new Set<string>();
  const queue = [path.join(process.cwd(), entry)];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || reached.has(current)) continue;
    reached.add(current);

    const source = readFileSync(current, 'utf8');
    for (const specifier of importedSpecifiers(source)) {
      const resolved = resolveSpecifier(current, specifier);
      if (resolved && resolved.startsWith(SRC_ROOT) && !reached.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return reached;
}

/** Forbidden modules reachable from `entry`, normalised to forward slashes. */
function leaksFrom(entry: string): string[] {
  return [...transitiveImports(entry)]
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => FORBIDDEN_SUBSTRINGS.some((forbidden) => file.includes(forbidden)));
}

describe('tracks domain stays backend-neutral', () => {
  it.each(shippedTracksEntries())('%s never transitively imports a SQLite or transaction primitive', (entry) => {
    expect(leaksFrom(entry)).toEqual([]);
  });

  it('the walker detects a real leak (negative control via the harness)', () => {
    // The harness imports sqlite-adapter directly to drive its parity matrix, so
    // a sound walker MUST report it — proving the green assertions above are not
    // vacuously passing on a walker that never resolves anything.
    expect(leaksFrom('src/lib/tracks/tracks-repo.harness.ts').length).toBeGreaterThan(0);
  });
});
