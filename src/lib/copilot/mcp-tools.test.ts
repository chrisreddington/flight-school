import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCopilotGithubMcpTools } from './mcp-tools';

describe('getCopilotGithubMcpTools', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return an empty allowlist when no environment override is set', () => {
    vi.stubEnv('COPILOT_GITHUB_MCP_TOOLS', '');

    expect(getCopilotGithubMcpTools()).toEqual([]);
  });

  it('should parse and trim the GitHub MCP tool allowlist', () => {
    vi.stubEnv('COPILOT_GITHUB_MCP_TOOLS', ' get_me, search_code, ,list_user_repositories ');

    expect(getCopilotGithubMcpTools()).toEqual([
      'get_me',
      'search_code',
      'list_user_repositories',
    ]);
  });
});
