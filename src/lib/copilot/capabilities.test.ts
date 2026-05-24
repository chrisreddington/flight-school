/**
 * Tests for the capability registry and the MCP-server builder.
 * Table-driven; asserts on observable behaviour only.
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_CAPABILITY_IDS,
  CAPABILITIES,
  buildMcpServersForCapabilities,
  type CapabilitySelection,
} from './capabilities';

describe('CAPABILITIES registry', () => {
  it.each(ALL_CAPABILITY_IDS)(
    'capability %s declares a non-empty prompt addendum, default tools, and a factory',
    (id) => {
      const spec = CAPABILITIES[id];
      expect(spec.id).toBe(id);
      expect(spec.promptAddendum.length).toBeGreaterThan(0);
      expect(spec.defaultTools.length).toBeGreaterThan(0);
      expect(typeof spec.buildMcpServer).toBe('function');
    },
  );

  it('github capability auto-elevates when prompt references repositories', () => {
    expect(CAPABILITIES.github.shouldElevate?.('list my repos')).toBe(true);
    expect(CAPABILITIES.github.shouldElevate?.('write a quarterly report')).toBe(false);
  });
});

describe('buildMcpServersForCapabilities', () => {
  it('returns an empty map when no capabilities are selected', () => {
    expect(buildMcpServersForCapabilities([], 'tok')).toEqual({});
  });

  it('keys each entry by the capability id so SDK telemetry stays readable', () => {
    const servers = buildMcpServersForCapabilities([{ id: 'github' }], 'tok');
    expect(Object.keys(servers)).toEqual(['github']);
  });

  it('binds the supplied token into the MCP server config', () => {
    const servers = buildMcpServersForCapabilities([{ id: 'github' }], 'my-token');
    const github = servers.github as { headers?: Record<string, string> };
    expect(github.headers?.Authorization).toBe('Bearer my-token');
  });

  it.each<{ name: string; selection: CapabilitySelection; expectedTools: readonly string[] }>([
    {
      name: 'default tool list when no override',
      selection: { id: 'github' },
      expectedTools: CAPABILITIES.github.defaultTools,
    },
    {
      name: 'profile-specific override',
      selection: { id: 'github', tools: ['get_me'] },
      expectedTools: ['get_me'],
    },
  ])('honours tool selection: $name', ({ selection, expectedTools }) => {
    const servers = buildMcpServersForCapabilities([selection], 'tok');
    const github = servers.github as { tools?: string[] };
    expect(github.tools).toEqual([...expectedTools]);
  });

  it('throws via the MCP factory when the token is empty', () => {
    expect(() => buildMcpServersForCapabilities([{ id: 'github' }], '')).toThrow();
  });
});
