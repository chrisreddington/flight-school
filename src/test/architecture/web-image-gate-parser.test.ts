import { describe, expect, it } from 'vitest';

// Import the parser helpers from the gate script. The script gates its
// IIFE on direct CLI invocation, so importing here is side-effect-free.
import {
  extractCopySources,
  isAllowedRunnerSource,
  // @ts-expect-error — .mjs script has no .d.ts; resolved at runtime.
} from '../../../scripts/check-web-image-copilot-free.mjs';

// These helpers are security-critical: they are the structural parser
// behind Assertion A (the positive-allowlist Dockerfile lint that keeps
// `@github/copilot*` out of the web image). A regression that widens
// either function silently lets a broad COPY through the gate, so the
// regression shapes below correspond to the historical bypass attempts
// the gate was hardened against.

describe('extractCopySources — shell-form COPY', () => {
  it('drops the destination and returns the single source', () => {
    expect(extractCopySources('COPY src/app /app')).toEqual(['src/app']);
  });

  it('returns multiple sources before the destination', () => {
    expect(extractCopySources('COPY a b c /dst')).toEqual(['a', 'b', 'c']);
  });

  it('skips `--flag=value` flags', () => {
    expect(extractCopySources('COPY --chown=node:node src /app')).toEqual([
      'src',
    ]);
  });

  it('skips `--flag value` flags (two-token form)', () => {
    expect(extractCopySources('COPY --chown node:node src /app')).toEqual([
      'src',
    ]);
  });

  it('skips boolean flags like `--link`', () => {
    expect(extractCopySources('COPY --link src /app')).toEqual(['src']);
  });

  it('skips multi-stage `--from=builder` flags', () => {
    expect(
      extractCopySources('COPY --from=builder /build/out /app/out'),
    ).toEqual(['/build/out']);
  });

  it('handles a flag mix in any order', () => {
    expect(
      extractCopySources(
        'COPY --from=builder --chown=node:node --link /build/out /app/out',
      ),
    ).toEqual(['/build/out']);
  });
});

describe('extractCopySources — JSON-array form', () => {
  it('returns array elements minus the final (destination) entry', () => {
    expect(extractCopySources('COPY ["src","/app"]')).toEqual(['src']);
  });

  it('handles flags before the JSON array', () => {
    expect(
      extractCopySources('COPY --chown=node:node ["src","/app"]'),
    ).toEqual(['src']);
  });

  it('handles single-quoted entries', () => {
    expect(extractCopySources("COPY ['a','b','/dst']")).toEqual(['a', 'b']);
  });
});

describe('isAllowedRunnerSource — accepts allowlisted sources', () => {
  it('accepts the exact `/app/public` source', () => {
    expect(isAllowedRunnerSource('/app/public')).toBe(true);
  });

  it('accepts `/app/public/` with a trailing slash', () => {
    expect(isAllowedRunnerSource('/app/public/')).toBe(true);
  });

  it('accepts the `/app/.next/` prefix', () => {
    expect(isAllowedRunnerSource('/app/.next/standalone')).toBe(true);
  });

  it('accepts the `/app/public/` prefix', () => {
    expect(isAllowedRunnerSource('/app/public/icons')).toBe(true);
  });
});

describe('isAllowedRunnerSource — rejects bypass shapes', () => {
  it('rejects the broad `/app` root', () => {
    expect(isAllowedRunnerSource('/app')).toBe(false);
  });

  it('rejects `/app/` with trailing slash', () => {
    expect(isAllowedRunnerSource('/app/')).toBe(false);
  });

  it('rejects `/app/node_modules`', () => {
    expect(isAllowedRunnerSource('/app/node_modules')).toBe(false);
  });

  it('rejects relative sources', () => {
    expect(isAllowedRunnerSource('.')).toBe(false);
    expect(isAllowedRunnerSource('./')).toBe(false);
    expect(isAllowedRunnerSource('*')).toBe(false);
    expect(isAllowedRunnerSource('src/app')).toBe(false);
  });

  it('rejects unresolved variable sources', () => {
    expect(isAllowedRunnerSource('${APP_DIR}')).toBe(false);
    expect(isAllowedRunnerSource('$(pwd)/src')).toBe(false);
    expect(isAllowedRunnerSource('/app/${SUB}')).toBe(false);
  });

  it('rejects prefix-traversal bypass via `..`', () => {
    // Historically a `/app/.next/../node_modules` source would pass the
    // prefix check while resolving outside the allowed subtree.
    expect(isAllowedRunnerSource('/app/.next/../node_modules')).toBe(false);
  });

  it('rejects prefix collisions that are not segment-bounded', () => {
    // `/app/publicity` shares the `/app/public` prefix textually but is
    // a distinct directory; the `/` boundary in the prefix list must
    // keep them separate.
    expect(isAllowedRunnerSource('/app/publicity')).toBe(false);
  });
});
