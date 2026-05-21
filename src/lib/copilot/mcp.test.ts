/**
 * Tests for MCP server configuration builder.
 *
 * Critically verifies that tokens are never shared across calls — the
 * config must be rebuilt per request so one user's bearer token cannot
 * leak into another user's session.
 */

import { describe, it, expect } from 'vitest';

import { getMcpServerConfig } from './mcp';

describe('getMcpServerConfig', () => {
  it('returns a config with the exact Authorization header for the supplied token', () => {
    const config = getMcpServerConfig({ token: 'ghs_user_a_token' });

    expect(config.type).toBe('http');
    expect(config.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(config.headers).toEqual({
      Authorization: 'Bearer ghs_user_a_token',
    });
  });

  it('uses the default tool allowlist when no tools are supplied', () => {
    const config = getMcpServerConfig({ token: 'tok' });

    expect(config.tools).toEqual(
      expect.arrayContaining([
        'get_me',
        'list_user_repositories',
        'get_file_contents',
        'search_code',
        'search_users',
      ])
    );
  });

  it('honors a custom tool allowlist', () => {
    const config = getMcpServerConfig({
      token: 'tok',
      tools: ['get_me'],
    });

    expect(config.tools).toEqual(['get_me']);
  });

  it('does not leak tokens between calls (regression: cached config bug)', () => {
    const configA = getMcpServerConfig({ token: 'token-user-a' });
    const configB = getMcpServerConfig({ token: 'token-user-b' });

    expect(configA.headers).toEqual({ Authorization: 'Bearer token-user-a' });
    expect(configB.headers).toEqual({ Authorization: 'Bearer token-user-b' });
    expect(configA.headers).not.toEqual(configB.headers);
  });

  it('throws when called without a token', () => {
    expect(() => getMcpServerConfig({ token: '' })).toThrow(
      'MCP config requires a GitHub token'
    );
  });
});
