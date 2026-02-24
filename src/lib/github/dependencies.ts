/**
 * Dependency File Analysis
 *
 * Fetches and parses dependency files from top repositories to extract
 * tech stack signals more precisely than language bytes alone.
 * Supports package.json, requirements.txt, go.mod, and Cargo.toml.
 */

import { getOctokit } from './client';
import { nowMs } from '@/lib/utils/date-utils';

// =============================================================================
// Constants
// =============================================================================

/** Cache TTL: 24 hours (dependency files change infrequently) */
const DEPS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum number of top-level dependencies to surface */
const MAX_DEPS = 20;

// =============================================================================
// Cache
// =============================================================================

interface CachedDeps {
  deps: string[];
  timestamp: number;
}

const depsCache = new Map<string, CachedDeps>();

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetches top-level dependencies from the most common dependency files in a repo.
 *
 * @remarks
 * Tries files in order: package.json → requirements.txt → go.mod → Cargo.toml.
 * Returns on first successful parse. Results are cached 24 hours.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Array of dependency names (up to MAX_DEPS)
 */
export async function getRepoDependencies(
  owner: string,
  repo: string
): Promise<string[]> {
  const cacheKey = `${owner}/${repo}`;
  const cached = depsCache.get(cacheKey);
  if (cached && nowMs() - cached.timestamp < DEPS_CACHE_TTL_MS) {
    return cached.deps;
  }

  const deps = await fetchDeps(owner, repo);
  depsCache.set(cacheKey, { deps, timestamp: nowMs() });
  return deps;
}

// =============================================================================
// Internal helpers
// =============================================================================

async function fetchDeps(owner: string, repo: string): Promise<string[]> {
  const octokit = await getOctokit();

  const parsers: Array<{ path: string; parse: (content: string) => string[] }> = [
    { path: 'package.json', parse: parsePackageJson },
    { path: 'requirements.txt', parse: parseRequirementsTxt },
    { path: 'go.mod', parse: parseGoMod },
    { path: 'Cargo.toml', parse: parseCargoToml },
  ];

  for (const { path, parse } of parsers) {
    try {
      const response = await octokit.rest.repos.getContent({ owner, repo, path });
      const data = response.data;
      if ('content' in data && typeof data.content === 'string') {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const deps = parse(content);
        if (deps.length > 0) return deps.slice(0, MAX_DEPS);
      }
    } catch {
      // File not found or error — try next
    }
  }

  return [];
}

function parsePackageJson(content: string): string[] {
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const deps = new Set<string>();
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const block = pkg[section];
      if (block && typeof block === 'object') {
        for (const name of Object.keys(block as Record<string, unknown>)) {
          // Strip scope from name for readability: @org/pkg → @org/pkg (keep as-is)
          deps.add(name);
        }
      }
    }
    return Array.from(deps);
  } catch {
    return [];
  }
}

function parseRequirementsTxt(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.split(/[>=<!\s]/)[0].trim())
    .filter((name) => name && !name.startsWith('#') && !name.startsWith('-'));
}

function parseGoMod(content: string): string[] {
  const deps: string[] = [];
  let inRequire = false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'require (') { inRequire = true; continue; }
    if (trimmed === ')') { inRequire = false; continue; }
    if (inRequire || trimmed.startsWith('require ')) {
      const parts = trimmed.replace(/^require\s+/, '').split(/\s+/);
      if (parts[0] && !parts[0].startsWith('//')) {
        deps.push(parts[0]);
      }
    }
  }

  return deps;
}

function parseCargoToml(content: string): string[] {
  const deps: string[] = [];
  let inDeps = false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '[dependencies]' || trimmed === '[dev-dependencies]') {
      inDeps = true;
      continue;
    }
    if (trimmed.startsWith('[')) { inDeps = false; continue; }
    if (inDeps && trimmed && !trimmed.startsWith('#')) {
      const name = trimmed.split('=')[0].trim();
      if (name) deps.push(name);
    }
  }

  return deps;
}
