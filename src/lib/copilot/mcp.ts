/**
 * MCP (Model Context Protocol) Server Configuration
 *
 * Manages configuration for GitHub's Remote MCP Server, which provides
 * access to GitHub tools like repo search, file contents, and code exploration.
 *
 * @see https://github.com/github/github-mcp-server
 */

import type { MCPServerConfig } from '@github/copilot-sdk';

// =============================================================================
// MCP Server Configuration
// =============================================================================

/**
 * Default MCP tool set.
 *
 * Uses an explicit allowlist of read-only GitHub MCP tools.
 * Built-in SDK tools (shell, write) are blocked separately via excludedTools.
 */
const DEFAULT_MCP_TOOLS = [
  'get_me',
  'list_user_repositories',
  'get_file_contents',
  'search_code',
  'search_users',
] as const;

/**
 * Build an MCP server configuration for GitHub tools.
 *
 * Uses the official Remote GitHub MCP Server hosted by GitHub. The caller
 * must supply the GitHub token to use for this request; the config is
 * built fresh per call so tokens are never shared across users.
 *
 * @param params - Per-request token and optional tool allowlist
 * @returns MCP server config bound to the supplied token
 * @throws If no token is supplied
 *
 * @see https://github.com/github/github-mcp-server
 */
export function getMcpServerConfig({
  token,
  tools = [...DEFAULT_MCP_TOOLS],
}: {
  token: string;
  tools?: string[];
}): MCPServerConfig {
  if (!token) {
    throw new Error('MCP config requires a GitHub token');
  }

  return {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    tools,
  };
}
