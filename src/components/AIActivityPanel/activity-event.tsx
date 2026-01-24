'use client';

/**
 * Individual activity event renderer with educational annotations
 */

import { ConversationBadge, McpToolsBadge, ModelBadge, StatusBadge, TtftBadges } from '@/components/StatusBadge';
import type { AIActivityEvent, AIActivityType } from '@/lib/copilot/activity/types';
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react';
import { useState } from 'react';
import styles from './AIActivityPanel.module.css';

/** Educational notes explaining what each operation type does */
const EDUCATIONAL_NOTES: Record<AIActivityType, string> = {
  embed: '💡 Converts text into a 256-dimensional vector. Similar concepts have similar vectors, enabling the Skill Constellation to cluster related skills together.',
  ask: '💡 Single-turn completion. The SDK sends this prompt to Copilot and returns the response. Used for challenge generation and insights.',
  session: '💡 Multi-turn conversation with memory. Each message builds on previous context. Powers the progressive hint system on hover.',
  tool: '💡 Custom tool invocation. The AI decided to call this function to gather information or take action.',
  error: '⚠️ An error occurred during this operation. Check the error message for details.',
  internal: '🔧 Internal operation for tracking or computation (e.g., cosine similarity).',
};

/** Status indicator icons */
const STATUS_ICONS: Record<string, string> = {
  pending: '◐',
  success: '●',
  error: '✗',
};

/** Status colors */
const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--fgColor-attention)',
  success: 'var(--fgColor-success)',
  error: 'var(--fgColor-danger)',
};

interface ActivityEventProps {
  event: AIActivityEvent;
  showEducational?: boolean;
}

/**
 * Formats a performance metric with color coding
 */
function formatLatency(ms: number): { text: string; color: string } {
  if (ms < 1000) return { text: `${ms}ms`, color: 'var(--fgColor-success)' };
  if (ms < 5000) return { text: `${(ms / 1000).toFixed(1)}s`, color: 'var(--fgColor-attention)' };
  return { text: `${(ms / 1000).toFixed(1)}s`, color: 'var(--fgColor-danger)' };
}

/**
 * Analyzes why a response might be slow
 */
function analyzePerformance(event: AIActivityEvent): string[] {
  const issues: string[] = [];
  const sessionMetrics = event.input?.sessionMetrics;
  const clientMetrics = event.input?.clientMetrics;
  const serverMetrics = event.input?.serverMetrics;
  
  // Use client TTFT as primary, fall back to server
  const firstTokenMs = clientMetrics?.firstTokenMs ?? serverMetrics?.firstTokenMs;
  const totalMs = clientMetrics?.totalMs ?? event.latencyMs;
  
  // Conversation creation overhead
  if (sessionMetrics && !sessionMetrics.poolHit && sessionMetrics.sessionCreateMs) {
    if (sessionMetrics.sessionCreateMs > 2000) {
      issues.push(`⚠️ Slow conversation setup (${sessionMetrics.sessionCreateMs}ms)`);
    } else if (sessionMetrics.sessionCreateMs > 500) {
      issues.push(`○ New conversation (${sessionMetrics.sessionCreateMs}ms)`);
    }
  }
  
  // MCP overhead
  if (sessionMetrics?.mcpEnabled && sessionMetrics.sessionCreateMs && sessionMetrics.sessionCreateMs > 1000) {
    issues.push('🔧 MCP tools enabled - adds initialization overhead');
  }
  
  // Time to first token
  if (firstTokenMs != null) {
    if (firstTokenMs > 5000) {
      issues.push(`🐌 Very slow first token (${firstTokenMs}ms) - possible model cold start or complex prompt`);
    } else if (firstTokenMs > 2000) {
      issues.push(`⏱️ Slow first token (${firstTokenMs}ms) - consider prompt optimization`);
    } else if (firstTokenMs < 500) {
      issues.push(`⚡ Fast first token (${firstTokenMs}ms) - excellent!`);
    }
  }
  
  // Total latency
  if (totalMs > 30000) {
    issues.push('🐢 Very long operation (>30s) - consider streaming or breaking into smaller requests');
  }
  
  // Tool usage
  const toolsUsed = event.output?.toolsUsed;
  if (toolsUsed && toolsUsed.length > 0) {
    issues.push(`🔨 Used ${toolsUsed.length} tool(s): ${toolsUsed.join(', ')} - adds latency for data fetching`);
  }
  
  return issues;
}

export function ActivityEvent({ event, showEducational = true }: ActivityEventProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  const timeStr = event.timestamp.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Use client metrics as single source of truth for UI display
  // Fall back to server metrics (latencyMs) if client metrics not available
  const clientMetrics = event.input?.clientMetrics;
  const serverMetrics = event.input?.serverMetrics;
  const sessionMetrics = event.input?.sessionMetrics;
  
  // Display latency: prefer client total (what user experienced), fall back to server latencyMs
  const displayLatencyMs = clientMetrics?.totalMs ?? event.latencyMs;
  const latency = formatLatency(displayLatencyMs);
  
  // TTFT: prefer client TTFT, fall back to server TTFT
  const displayTtftMs = clientMetrics?.firstTokenMs ?? serverMetrics?.firstTokenMs ?? undefined;
  
  const performanceIssues = analyzePerformance(event);

  return (
    <div className={styles.eventContainer}>
      {/* Header row */}
      <div className="d-flex flex-items-center gap-2">
        <span className={`f6 color-fg-muted ${styles.eventHeader}`}>{timeStr}</span>
        <span style={{ color: STATUS_COLORS[event.status] }}>{STATUS_ICONS[event.status]}</span>
        <span className={styles.eventOperation}>{event.operation}</span>
        <span className={`f6 ml-auto ${styles.eventLatency}`} style={{ color: latency.color }}>
          {event.status === 'pending' ? 'running...' : latency.text}
        </span>
      </div>

      {/* Performance badges - STANDARDIZED ORDER: conversation, server→client TTFT flow, total, model, MCP */}
      <div className={`d-flex gap-1 mt-2 ${styles.badgeRow}`}>
        {/* 1. Conversation state (shows session creation overhead) */}
        {sessionMetrics && (
          <ConversationBadge 
            reused={sessionMetrics.poolHit ?? false} 
            createTimeMs={sessionMetrics.poolHit ? undefined : sessionMetrics.sessionCreateMs} 
          />
        )}
        {/* 2. TTFT - Server→Client flow (server time INCLUDES session creation) */}
        {displayTtftMs != null && (
          <TtftBadges 
            serverMs={serverMetrics?.firstTokenMs ?? undefined}
            clientMs={clientMetrics?.firstTokenMs}
          />
        )}
        {/* 3. Total time (end-to-end completion) */}
        {displayLatencyMs > 0 && event.status === 'success' && (
          <StatusBadge variant="info">
            Total: {displayLatencyMs}ms
          </StatusBadge>
        )}
        {/* 4. Model (metadata) */}
        {event.input?.model && (
          <ModelBadge model={event.input.model} />
        )}
        {/* 5. MCP tools (feature indicator) */}
        {sessionMetrics?.mcpEnabled && <McpToolsBadge />}
      </div>

      {/* Performance analysis */}
      {performanceIssues.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className={`f6 ${styles.perfInsightsSummary}`}>
            🔍 Performance insights ({performanceIssues.length})
          </summary>
          <div className={styles.perfInsightsContent}>
            {performanceIssues.map((issue) => (
              <div key={`perf-${issue.slice(0, 40)}`} className={styles.perfInsightItem}>
                {issue}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Input/Prompt section */}
      {(event.input?.prompt || event.input?.text) && (
        <div className={styles.metaInfo}>
          <button onClick={() => setIsExpanded(!isExpanded)} className={`f6 ${styles.expandButton}`}>
            {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            <span>Prompt</span>
          </button>
          {isExpanded && (
            <div className={styles.codeBlock}>
              {event.input?.prompt || event.input?.text}
            </div>
          )}
        </div>
      )}

      {/* Response section */}
      {event.output?.fullResponse && (
        <div className={styles.metaInfo}>
          <button onClick={() => setShowResponse(!showResponse)} className={`f6 ${styles.expandButton}`}>
            {showResponse ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            <span>Response ({event.output.fullResponse.length} chars)</span>
          </button>
          {showResponse && (
            <div className={styles.codeBlockResponse}>
              {event.output.fullResponse}
            </div>
          )}
        </div>
      )}

      {/* Token usage */}
      {event.output?.tokens && (
        <div className={`f6 color-fg-muted ${styles.metaInfo}`}>
          📊 Tokens: {event.output.tokens.input} in / {event.output.tokens.output} out
          {' '}({event.output.tokens.input + event.output.tokens.output} total)
        </div>
      )}
      
      {/* Embedding info */}
      {event.output?.embedding && (
        <div className={`f6 color-fg-muted ${styles.metaInfo}`}>
          Vector: {event.output.embedding.dimensions} dimensions
        </div>
      )}

      {/* Educational note */}
      {showEducational && (
        <div className={event.type === 'error' ? styles.noteBoxError : styles.noteBoxEducational}>
          {EDUCATIONAL_NOTES[event.type]}
        </div>
      )}

      {/* Error display */}
      {event.error && (
        <div className={styles.errorDisplay}>
          <strong>Error:</strong> {event.error}
        </div>
      )}
    </div>
  );
}
