'use client';

import { MarkdownContent } from '@/components/MarkdownContent';
import { ConversationBadge, McpToolsBadge, ModelBadge, StatusBadge, TtftBadges } from '@/components/StatusBadge';
import { useDebugMode } from '@/contexts/debug-context';
import type { Message } from '@/lib/threads/types';
import { CopilotIcon, LightBulbIcon, PersonIcon } from '@primer/octicons-react';
import { Avatar, Banner, Label, RelativeTime, SkeletonBox, Stack } from '@primer/react';
import { memo } from 'react';
import styles from './MessageBubble.module.css';

/**
 * Props for the {@link MessageBubble} component.
 */
interface MessageBubbleProps {
  /** The message to display */
  message: Message;
  /** Whether this is the currently streaming message */
  isStreaming?: boolean;
  /** The current streaming content (for streaming messages) */
  streamingContent?: string;
  /** User's avatar URL (for user messages) */
  userAvatarUrl?: string;
  /** Whether to show the smart action indicator */
  showSmartActionIndicator?: boolean;
  /** Whether the message has an error */
  isError?: boolean;
}

/**
 * Renders a single chat message with role-based styling.
 * 
 * Supports markdown content, code highlighting, streaming state,
 * and smart action indicators for actionable content.
 * 
 * PERF: Memoized to prevent re-renders when parent state changes.
 * Only re-renders when message content or streaming state changes.
 * 
 * @example
 * ```tsx
 * <MessageBubble
 *   message={message}
 *   isStreaming={false}
 *   userAvatarUrl={user.avatar_url}
 * />
 * ```
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming = false,
  streamingContent,
  userAvatarUrl,
  showSmartActionIndicator,
  isError = false,
}: MessageBubbleProps) {
  const { isDebugMode } = useDebugMode();
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const hasActionable = showSmartActionIndicator ?? message.hasActionableItem;
  
  // Content to display (streaming content overrides stored content)
  const displayContent = isStreaming && streamingContent 
    ? streamingContent 
    : message.content;

  return (
    <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.assistantBubble}`}>
      <Stack direction="horizontal" gap="condensed" align="start">
        {/* Avatar */}
        <div className={styles.avatar}>
          {isUser ? (
            userAvatarUrl ? (
              <Avatar src={userAvatarUrl} size={32} alt="You" />
            ) : (
              <div className={styles.defaultAvatar}>
                <PersonIcon size={16} />
              </div>
            )
          ) : (
            <div className={styles.copilotAvatar}>
              <CopilotIcon size={16} />
            </div>
          )}
        </div>

        {/* Message Content */}
        <div className={styles.content}>
          {/* Header */}
          <Stack direction="horizontal" align="center" gap="condensed" className={styles.header}>
            <span className={styles.role}>
              {isUser ? 'You' : 'Copilot'}
            </span>
            <RelativeTime date={new Date(message.timestamp)} className={styles.timestamp} />
            {hasActionable && isAssistant && !isError && (
              <Label variant="attention" size="small">
                <Stack direction="horizontal" align="center" gap="condensed">
                  <LightBulbIcon size={12} />
                  <span>Actionable</span>
                </Stack>
              </Label>
            )}
          </Stack>

          {/* Body */}
          {isError ? (
            <Banner variant="critical" title="Error" hideTitle className={styles.errorBanner}>
              {displayContent}
            </Banner>
          ) : isStreaming && !displayContent ? (
            <div className={styles.loadingState}>
              <SkeletonBox height="3em" />
            </div>
          ) : (
            <div className={styles.messageContent}>
              <MarkdownContent content={displayContent} isStreaming={isStreaming} />
            </div>
          )}

          {/* Tool calls indicator */}
          {isDebugMode && message.toolCalls && message.toolCalls.length > 0 && (
            <div className={styles.toolCallsIndicator}>
              <span className={styles.toolCallsText}>
                Used {message.toolCalls.length} tool{message.toolCalls.length !== 1 ? 's' : ''}:{' '}
                {message.toolCalls.join(', ')}
              </span>
            </div>
          )}

          {/* Performance metrics - STANDARDIZED ORDER: conversation, server→client TTFT flow, total, model, MCP */}
          {isDebugMode && isAssistant && message.perf && !isStreaming && (
            <div className={styles.perfMetrics}>
              {/* 1. Conversation state (shows session creation overhead) */}
              {message.perf.sessionPoolHit !== undefined && (
                <ConversationBadge 
                  reused={message.perf.sessionPoolHit} 
                  createTimeMs={message.perf.sessionPoolHit ? undefined : message.perf.sessionCreateMs ?? undefined}
                />
              )}
              {/* 2. TTFT - Server→Client flow (server time INCLUDES session creation) */}
              <TtftBadges 
                serverMs={message.perf.serverFirstTokenMs ?? undefined}
                clientMs={message.perf.clientFirstTokenMs}
              />
              {/* 3. Total time (end-to-end completion) */}
              {message.perf.clientTotalMs !== undefined && (
                <StatusBadge variant="info">
                  Total: {message.perf.clientTotalMs}ms
                </StatusBadge>
              )}
              {/* 4. Model (metadata) */}
              {message.perf.model && (
                <ModelBadge model={message.perf.model} />
              )}
              {/* 5. MCP tools (feature indicator) */}
              {message.perf.mcpEnabled && <McpToolsBadge />}
            </div>
          )}
        </div>
      </Stack>
    </div>
  );
});

