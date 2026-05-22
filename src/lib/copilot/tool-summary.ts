/**
 * Tool Summary Helper
 *
 * Maps raw Copilot/MCP tool invocations to human-readable status lines so the
 * chat UI can render trust-calibrating "what is the agent doing" narration
 * outside of debug mode.
 *
 * Designed to be defensive — tool argument shapes vary across SDK/MCP versions,
 * so every accessor is guarded and we always fall back to the bare tool name
 * rather than throwing.
 */

/** Result of summarising a single tool call. */
export interface ToolSummaryResult {
  /** Single-character icon prefix conveying the action category. */
  icon: string;
  /** Human-readable one-line description, e.g. "Searching code in foo/bar for auth". */
  summary: string;
}

/** Strip MCP namespace prefixes so we can match on the bare tool name. */
function normaliseName(name: string): string {
  return name.replace(/^(mcp\.|github\.)+/i, '').toLowerCase();
}

/** Safe accessor for a string field on an unknown args object. */
function pickString(args: unknown, ...keys: string[]): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const obj = args as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Try to recover an `owner/repo` string from various MCP arg shapes. */
function pickRepo(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const obj = args as Record<string, unknown>;
  const owner = typeof obj.owner === 'string' ? obj.owner : undefined;
  const repo = typeof obj.repo === 'string' ? obj.repo : undefined;
  if (owner && repo) return `${owner}/${repo}`;
  const full =
    pickString(obj, 'repository', 'repo_full_name', 'fullName', 'full_name') ??
    pickString(obj, 'q', 'query')?.match(/repo:([\w.-]+\/[\w.-]+)/)?.[1];
  return full;
}

/** Inline-code formatter used in summaries. */
function code(value: string | undefined): string {
  if (!value) return '';
  return `\`${value}\``;
}

/**
 * Summarise a tool invocation into an icon + one-line description.
 *
 * Falls back to the bare tool name (e.g. "Running `unknown_tool`…") when the
 * tool is not in the known map, so that unknown tools still surface to users.
 *
 * @example
 * ```ts
 * toolSummary('search_code', { q: 'auth', owner: 'foo', repo: 'bar' });
 * // → { icon: '🔍', summary: 'Searching code in `foo/bar` for `auth`' }
 * ```
 */
export function toolSummary(name: string, args?: unknown): ToolSummaryResult {
  const key = normaliseName(name);

  switch (key) {
    case 'search_code': {
      const repo = pickRepo(args);
      const query = pickString(args, 'q', 'query');
      const where = repo ? ` in ${code(repo)}` : '';
      const what = query ? ` for ${code(query)}` : '';
      return { icon: '🔍', summary: `Searching code${where}${what}` };
    }
    case 'search_repositories':
    case 'search_repos': {
      const query = pickString(args, 'query', 'q');
      return {
        icon: '🔍',
        summary: query ? `Searching repositories for ${code(query)}` : 'Searching repositories',
      };
    }
    case 'search_issues':
    case 'search_pull_requests': {
      const query = pickString(args, 'query', 'q');
      const label = key === 'search_issues' ? 'issues' : 'pull requests';
      return {
        icon: '🔍',
        summary: query ? `Searching ${label} for ${code(query)}` : `Searching ${label}`,
      };
    }
    case 'get_file_contents':
    case 'read_file': {
      const repo = pickRepo(args);
      const path = pickString(args, 'path', 'file_path', 'filename');
      if (path && repo) return { icon: '📄', summary: `Reading ${code(path)} from ${code(repo)}` };
      if (path) return { icon: '📄', summary: `Reading ${code(path)}` };
      if (repo) return { icon: '📄', summary: `Reading file from ${code(repo)}` };
      return { icon: '📄', summary: 'Reading file' };
    }
    case 'list_commits': {
      const repo = pickRepo(args);
      return {
        icon: '🧾',
        summary: repo ? `Listing commits on ${code(repo)}` : 'Listing commits',
      };
    }
    case 'get_commit': {
      const repo = pickRepo(args);
      const sha = pickString(args, 'sha', 'ref', 'commit_sha');
      const shortSha = sha ? sha.slice(0, 7) : undefined;
      if (repo && shortSha) return { icon: '🧾', summary: `Reading commit ${code(shortSha)} on ${code(repo)}` };
      if (repo) return { icon: '🧾', summary: `Reading commit on ${code(repo)}` };
      return { icon: '🧾', summary: 'Reading commit' };
    }
    case 'list_pull_requests':
    case 'list_prs': {
      const repo = pickRepo(args);
      return {
        icon: '🔀',
        summary: repo ? `Listing pull requests on ${code(repo)}` : 'Listing pull requests',
      };
    }
    case 'get_pull_request':
    case 'get_pr': {
      const repo = pickRepo(args);
      const num = pickString(args, 'pull_number', 'number', 'pr_number');
      if (repo && num) return { icon: '🔀', summary: `Reading PR #${num} on ${code(repo)}` };
      return { icon: '🔀', summary: repo ? `Reading pull request on ${code(repo)}` : 'Reading pull request' };
    }
    case 'list_issues': {
      const repo = pickRepo(args);
      return {
        icon: '🐛',
        summary: repo ? `Listing issues on ${code(repo)}` : 'Listing issues',
      };
    }
    case 'get_issue': {
      const repo = pickRepo(args);
      const num = pickString(args, 'issue_number', 'number');
      if (repo && num) return { icon: '🐛', summary: `Reading issue #${num} on ${code(repo)}` };
      return { icon: '🐛', summary: repo ? `Reading issue on ${code(repo)}` : 'Reading issue' };
    }
    case 'get_repository':
    case 'get_repo': {
      const repo = pickRepo(args);
      return {
        icon: '📦',
        summary: repo ? `Looking up ${code(repo)}` : 'Looking up repository',
      };
    }
    case 'list_branches': {
      const repo = pickRepo(args);
      return {
        icon: '🌿',
        summary: repo ? `Listing branches on ${code(repo)}` : 'Listing branches',
      };
    }
    case 'list_repositories':
    case 'list_repos':
      return { icon: '📦', summary: 'Listing repositories' };
    case 'get_me':
    case 'get_authenticated_user':
      return { icon: '👤', summary: 'Reading your GitHub profile' };
    default:
      return { icon: '🛠️', summary: `Running ${code(name)}` };
  }
}
