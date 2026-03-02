/**
 * MCP (Model Context Protocol) Server Configuration
 *
 * Manages configuration for GitHub's Remote MCP Server, which provides
 * access to GitHub tools like repo search, file contents, and code exploration.
 *
 * @see https://github.com/github/github-mcp-server
 */

import type { MCPRemoteServerConfig } from '@github/copilot-sdk';

// =============================================================================
// MCP Server Configuration
// =============================================================================

/** Cached MCP server configs keyed by tool list */
const cachedMcpConfigs = new Map<string, MCPRemoteServerConfig>();

/**
 * Default MCP tool set.
 *
 * Uses wildcard to include all tools from the Remote GitHub MCP Server.
 * These are all read-only GitHub exploration tools (search, read files, etc.).
 * Built-in SDK tools (shell, write) are blocked separately via excludedTools
 * in session creation.
 */
const DEFAULT_MCP_TOOLS = ['*'] as const;

/**
 * Get MCP server configuration for GitHub tools.
 * Uses official Remote GitHub MCP Server hosted by GitHub.
 *
 * Auth is handled automatically by the Copilot SDK backend — it already
 * knows the user's identity from `gh auth`. No manual token needed.
 * This gives full access to repos the user can access (including private).
 *
 * @param tools - Array of MCP tools to enable (defaults to all)
 * @returns MCP server config
 *
 * @see https://github.com/github/github-mcp-server
 */
export function getMcpServerConfig(
  tools: string[] = [...DEFAULT_MCP_TOOLS]
): MCPRemoteServerConfig {
  const toolKey = tools.join(',');
  const cached = cachedMcpConfigs.get(toolKey);
  if (cached) {
    return cached;
  }

  const config: MCPRemoteServerConfig = {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    tools,
  };

  cachedMcpConfigs.set(toolKey, config);
  return config;
}
