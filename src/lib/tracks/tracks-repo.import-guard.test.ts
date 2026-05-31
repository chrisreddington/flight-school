/**
 * Static guard: the tracks domain never reaches a SQLite or transaction
 * primitive through its transitive import graph.
 *
 * `tracks-repo.ts` and `enrollment-reconciliation.ts` are deliberately
 * backend-neutral — they depend only on the {@link UserScopedStore} contract so
 * they run unchanged on every storage adapter. If either ever transitively
 * imported `sqlite-adapter.ts` (the only home of `node:sqlite`, `DatabaseSync`,
 * and `withTransaction`) or the `factory.ts` that constructs it, the domain
 * would couple to a concrete backend and break that promise. A single-file
 * string grep can't catch a leak introduced two hops away, so this walks the
 * TS-resolved import edges recursively and asserts the forbidden modules are
 * unreachable.
 *
 * @module tracks/tracks-repo.import-guard.test
 */

import { readFileSync } from 'fs';
import path from 'path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.join(process.cwd(), 'src');

const ENTRY_POINTS = ['src/lib/tracks/tracks-repo.ts', 'src/lib/tracks/enrollment-reconciliation.ts'];

/**
 * Modules that must never appear in the tracks import graph. `sqlite-adapter`
 * owns every `node:sqlite` / `DatabaseSync` / `withTransaction` reference;
 * `factory` is the only other module that imports `node:sqlite`.
 */
const FORBIDDEN_SUBSTRINGS = ['storage/document-store/sqlite-adapter', 'storage/document-store/factory'];

/** Collect the relative module specifiers a TypeScript source imports. */
function relativeSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  for (const statement of file.statements) {
    const isImport = ts.isImportDeclaration(statement);
    const isExportFrom = ts.isExportDeclaration(statement) && statement.moduleSpecifier;
    if (!isImport && !isExportFrom) continue;

    const moduleSpecifier = (statement as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier;
    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text.startsWith('.')) {
      specifiers.push(moduleSpecifier.text);
    }
  }

  return specifiers;
}

/** Resolve a relative specifier from `fromFile` to an on-disk `.ts` path. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
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
    for (const specifier of relativeSpecifiers(source)) {
      const resolved = resolveSpecifier(current, specifier);
      if (resolved && resolved.startsWith(SRC_ROOT) && !reached.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return reached;
}

describe('tracks domain stays backend-neutral', () => {
  it.each(ENTRY_POINTS)('%s never transitively imports a SQLite or transaction primitive', (entry) => {
    const reached = [...transitiveImports(entry)].map((file) => file.replace(/\\/g, '/'));

    const leaks = reached.filter((file) => FORBIDDEN_SUBSTRINGS.some((forbidden) => file.includes(forbidden)));

    expect(leaks).toEqual([]);
  });
});
