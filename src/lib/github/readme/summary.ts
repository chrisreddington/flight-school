/**
 * README Summary Module
 *
 * Fetches and extracts key information from repository README files.
 * Uses raw text extraction with keyword detection for context enrichment.
 */

import { nowMs } from '@/lib/utils/date-utils';
import { getOctokit } from '../client';

// =============================================================================
// Constants
// =============================================================================

/** Cache TTL: 24 hours (README content rarely changes) */
const README_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum README size to fetch (1KB to minimize API overhead) */
const MAX_README_SIZE = 1024;

/** Maximum summary length to return */
const MAX_SUMMARY_LENGTH = 200;

// =============================================================================
// Types
// =============================================================================

interface CachedReadme {
  summary: ReadmeSummary;
  timestamp: number;
}

/**
 * Summary extracted from a repository README.
 */
export interface ReadmeSummary {
  /** First ~200 chars of README content (truncated) */
  excerpt: string;
  /** Keywords extracted from README (frameworks, tools, concepts) */
  keywords: string[];
  /** Whether README was found */
  found: boolean;
}

// =============================================================================
// Cache
// =============================================================================

const readmeCache = new Map<string, CachedReadme>();

// =============================================================================
// Keyword Patterns
// =============================================================================

/**
 * Keywords to detect in README content.
 * Organized by category for potential future filtering.
 */
const KEYWORD_PATTERNS: Record<string, RegExp> = {
  // Frameworks/Libraries
  react: /\breact\b/i,
  vue: /\bvue(?:\.?js)?\b/i,
  angular: /\bangular\b/i,
  nextjs: /\bnext\.?js\b/i,
  express: /\bexpress(?:\.?js)?\b/i,
  nestjs: /\bnest\.?js\b/i,
  django: /\bdjango\b/i,
  flask: /\bflask\b/i,
  rails: /\brails\b/i,
  spring: /\bspring\b/i,
  
  // Tools/Platforms
  docker: /\bdocker\b/i,
  kubernetes: /\bkubernetes\b|\bk8s\b/i,
  aws: /\baws\b|\bamazon web services\b/i,
  azure: /\bazure\b/i,
  gcp: /\bgcp\b|\bgoogle cloud\b/i,
  graphql: /\bgraphql\b/i,
  rest: /\brest\s?api\b/i,
  postgres: /\bpostgres(?:ql)?\b/i,
  mongodb: /\bmongo(?:db)?\b/i,
  redis: /\bredis\b/i,
  
  // Concepts
  api: /\bapi\b/i,
  cli: /\bcli\b|\bcommand.?line\b/i,
  testing: /\btesting\b|\btest\b/i,
  ci: /\bci(?:\/cd)?\b|\bcontinuous integration\b/i,
  authentication: /\bauth(?:entication)?\b|\boauth\b|\bjwt\b/i,
  realtime: /\breal.?time\b|\bwebsocket\b/i,
  machine_learning: /\bmachine learning\b|\bml\b|\bai\b/i,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extracts a clean excerpt from README content.
 * Strips markdown formatting and takes first meaningful text.
 */
function extractExcerpt(content: string): string {
  // Remove markdown headers (#, ##, etc.)
  let cleaned = content.replace(/^#+\s+.+$/gm, '');
  
  // Remove markdown links [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Remove markdown images ![alt](url)
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  
  // Remove code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`[^`]+`/g, '');
  
  // Remove badges (common pattern: [![text](image)](link))
  cleaned = cleaned.replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, '');
  
  // Remove HTML tags (loop to handle nested/malformed tags)
  let previousLength;
  do {
    previousLength = cleaned.length;
    cleaned = cleaned.replace(/<[^>]+>/g, '');
  } while (cleaned.length < previousLength);
  
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Take first MAX_SUMMARY_LENGTH characters, ending at word boundary
  if (cleaned.length <= MAX_SUMMARY_LENGTH) {
    return cleaned;
  }
  
  const truncated = cleaned.slice(0, MAX_SUMMARY_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

/**
 * Extracts keywords from README content based on known patterns.
 */
function extractKeywords(content: string): string[] {
  const found: string[] = [];
  
  for (const [keyword, pattern] of Object.entries(KEYWORD_PATTERNS)) {
    if (pattern.test(content)) {
      found.push(keyword);
    }
  }
  
  return found;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetches and summarizes a repository's README file.
 *
 * Extracts:
 * - First ~200 characters of content
 * - Keywords matching common frameworks/tools/concepts
 *
 * Results are cached for 24 hours per repository.
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @returns README summary with excerpt and keywords
 *
 * @example
 * ```typescript
 * const summary = await getRepoReadmeSummary('octocat', 'hello-world');
 * // Returns: \{ excerpt: "A sample project...", keywords: ["react", "api"], found: true \}
 * ```
 */
export async function getRepoReadmeSummary(
  owner: string,
  repo: string
): Promise<ReadmeSummary> {
  const cacheKey = `${owner}/${repo}`;
  const now = nowMs();

  // Check cache first
  const cached = readmeCache.get(cacheKey);
  if (cached && now - cached.timestamp < README_CACHE_TTL_MS) {
    return cached.summary;
  }

  try {
    const octokit = await getOctokit();
    
    // Fetch README using raw media type for plain text
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo,
      mediaType: {
        format: 'raw',
      },
    });

    // Data comes as string when using raw format
    const content = typeof data === 'string' ? data : '';
    
    // Truncate to MAX_README_SIZE for processing
    const truncatedContent = content.slice(0, MAX_README_SIZE);
    
    // Extract excerpt (first meaningful content, not markdown headers)
    const excerpt = extractExcerpt(truncatedContent);
    
    // Extract keywords
    const keywords = extractKeywords(truncatedContent);

    const summary: ReadmeSummary = {
      excerpt,
      keywords,
      found: true,
    };

    // Cache the result
    readmeCache.set(cacheKey, { summary, timestamp: now });
    return summary;
  } catch {
    // README not found or error - return empty summary
    const summary: ReadmeSummary = {
      excerpt: '',
      keywords: [],
      found: false,
    };
    
    // Cache the "not found" result to avoid repeated API calls
    readmeCache.set(cacheKey, { summary, timestamp: now });
    return summary;
  }
}
