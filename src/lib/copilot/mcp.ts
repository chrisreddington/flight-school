/**
 * MCP (Model Context Protocol) Server Configuration
 *
 * Manages configuration for GitHub's Remote MCP Server, which provides
 * access to GitHub tools like repo search, file contents, and code exploration.
 *
 * @see https://github.com/github/github-mcp-server
 */

import type { MCPServerConfig } from '@github/copilot-sdk';
import { getGitHubToken } from '../github/client';
import { logger } from '../logger';

const log = logger.withTag('Copilot SDK');

// =============================================================================
// MCP Server Configuration
// =============================================================================

/** Cached MCP server configs keyed by tool list */
const cachedMcpConfigs = new Map<string, MCPServerConfig>();

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
 * Get MCP server configuration for GitHub tools.
 * Uses official Remote GitHub MCP Server hosted by GitHub.
 *
 * Uses the same centralized GitHub token as Octokit auth so MCP tool
 * authorization matches repository access in the rest of the app.
 *
 * @param tools - Array of MCP tools to enable (defaults to all)
 * @returns MCP server config
 *
 * @see https://github.com/github/github-mcp-server
 */
export async function getMcpServerConfig(
  tools: string[] = [...DEFAULT_MCP_TOOLS]
): Promise<MCPServerConfig | null> {
  const toolKey = tools.join(',');
  const cached = cachedMcpConfigs.get(toolKey);
  if (cached) {
    return cached;
  }

  const token = await getGitHubToken();
  if (!token) {
    log.warn('No GitHub token available - MCP tools will be disabled');
    return null;
  }

  const config: MCPServerConfig = {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    tools,
  };

  cachedMcpConfigs.set(toolKey, config);
  return config;
}
