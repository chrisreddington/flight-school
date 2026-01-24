/**
 * StatusBadge - Consistent status indicator badges
 *
 * Used across AI activity panel and chat messages to show:
 * - Conversation state (new vs reused)
 * - Performance metrics
 * - Feature indicators (MCP tools, model, etc.)
 */

import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'info' | 'neutral';

interface StatusBadgeProps {
  /** Badge variant determines color scheme */
  variant: BadgeVariant;
  /** Icon emoji to display */
  icon?: string;
  /** Badge text content */
  children: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  success: {
    backgroundColor: 'var(--bgColor-success-muted)',
    color: 'var(--fgColor-success)',
  },
  warning: {
    backgroundColor: 'var(--bgColor-attention-muted)',
    color: 'var(--fgColor-attention)',
  },
  info: {
    backgroundColor: 'var(--bgColor-accent-muted)',
    color: 'var(--fgColor-accent)',
  },
  neutral: {
    backgroundColor: 'var(--bgColor-muted)',
    color: 'var(--fgColor-muted)',
  },
};

const baseStyles: React.CSSProperties = {
  borderRadius: 12,
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

/**
 * Generic status badge component.
 */
export function StatusBadge({ variant, icon, children }: StatusBadgeProps): React.ReactElement {
  return (
    <span className="f6" style={{ ...baseStyles, ...variantStyles[variant] }}>
      {icon && <span>{icon}</span>}
      {children}
    </span>
  );
}

// =============================================================================
// Semantic Badge Components - Use consistent terminology
// =============================================================================

interface ConversationBadgeProps {
  /** Whether this is a reused conversation (vs new) */
  reused: boolean;
  /** Session creation time in ms (shown for new conversations) */
  createTimeMs?: number;
}

/**
 * Shows conversation state: reused (fast) or new.
 *
 * Terminology: We use "conversation" consistently for user-facing text.
 * Internally the SDK uses "session" but users think in terms of conversations.
 * 
 * Note: Session creation time is INCLUDED in server metrics, not separate.
 */
export function ConversationBadge({ reused, createTimeMs }: ConversationBadgeProps): React.ReactElement {
  if (reused) {
    return (
      <StatusBadge variant="success" icon="⚡">
        Conversation reused
      </StatusBadge>
    );
  }
  return (
    <StatusBadge variant="warning" icon="🔄">
      New conversation{createTimeMs != null && ` (${createTimeMs}ms setup)`}
    </StatusBadge>
  );
}

/**
 * Shows that MCP tools are enabled for this request.
 */
export function McpToolsBadge(): React.ReactElement {
  return (
    <StatusBadge variant="info" icon="🔧">
      MCP tools
    </StatusBadge>
  );
}

interface ModelBadgeProps {
  /** Model name to display */
  model: string;
}

/**
 * Shows which AI model is being used.
 */
export function ModelBadge({ model }: ModelBadgeProps): React.ReactElement {
  return (
    <StatusBadge variant="neutral" icon="🤖">
      {model}
    </StatusBadge>
  );
}

interface TtftBadgesProps {
  /** Client-side TTFT in ms (end-to-end including network) */
  clientMs?: number;
  /** Server-side TTFT in ms (SDK processing only) */
  serverMs?: number;
}

/**
 * Shows TTFT metrics in logical server→client flow.
 * 
 * - Server: SDK processing time (includes session creation if new)
 * - TTFT: Client-side timing (Server + network latency)
 * 
 * Order shows the flow: token generated on server → received by client
 */
export function TtftBadges({ clientMs, serverMs }: TtftBadgesProps): React.ReactElement | null {
  if (clientMs == null && serverMs == null) return null;
  
  return (
    <>
      {serverMs != null && (
        <StatusBadge variant="info" icon="🖥️">
          Server: {serverMs}ms
        </StatusBadge>
      )}
      {clientMs != null && (
        <StatusBadge variant="info" icon="⚡">
          TTFT: {clientMs}ms
        </StatusBadge>
      )}
    </>
  );
}
