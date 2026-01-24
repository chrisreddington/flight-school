/**
 * MCP (Model Context Protocol) Server Configuration
 *
 * Manages configuration for GitHub's Remote MCP Server, which provides
 * access to GitHub tools like repo search, file contents, and code exploration.
 *
 * @see https://github.com/github/github-mcp-server
 */

import type { MCPRemoteServerConfig } from '@github/copilot-sdk';

import { getGitHubToken } from '../github/client';
import { logger } from '../logger';

const log = logger.withTag('Copilot SDK');

// =============================================================================
// MCP Server Configuration
// =============================================================================

/** Cached MCP server configs keyed by tool list */
const cachedMcpConfigs = new Map<string, MCPRemoteServerConfig>();

/** Default MCP tool set (full access) */
const DEFAULT_MCP_TOOLS = ['*'] as const;

/**
 * Get MCP server configuration for GitHub tools.
 * Uses official Remote GitHub MCP Server hosted by GitHub.
 *
 * Benefits over local Docker:
 * - No Docker dependency
 * - Always up-to-date
 * - Faster startup (no container spin-up)
 * - Additional remote-only toolsets (copilot, copilot_spaces, docs search)
 *
 * Uses centralized `getGitHubToken()` from `@/lib/github/client` which
 * supports both GITHUB_TOKEN env var and `gh auth token` CLI fallback.
 *
 * @param tools - Array of MCP tools to enable (defaults to all)
 * @returns MCP config or null if no GitHub token available
 *
 * @see https://github.com/github/github-mcp-server
 */
export async function getMcpServerConfig(
  tools: string[] = [...DEFAULT_MCP_TOOLS]
): Promise<MCPRemoteServerConfig | null> {
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

  const config: MCPRemoteServerConfig = {
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
