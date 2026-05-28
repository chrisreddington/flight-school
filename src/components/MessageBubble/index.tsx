'use client';

import { MarkdownContent } from '@/components/MarkdownContent';
import { ConversationBadge, McpToolsBadge, ModelBadge, StatusBadge, TtftBadges } from '@/components/StatusBadge';
import { useDebugMode } from '@/contexts/debug-context';
import { toolSummary } from '@/lib/copilot/tool-summary';
import type { Message, ToolCallEvent } from '@/lib/threads/types';
import { CheckIcon, CopilotIcon, LightBulbIcon, PersonIcon } from '@primer/octicons-react';
import { Avatar, Banner, Button, Label, RelativeTime, SkeletonBox, Spinner, Stack } from '@primer/react';
import { memo, useMemo } from 'react';
import styles from './MessageBubble.module.css';

/**
 * Props for the {@link MessageBubble} component.
 */
interface MessageBubbleProps {
  /** The message to display */
  message: Message;
  /** Whether this is the currently streaming message */
  isStreaming?: boolean;
  /** User's avatar URL (for user messages) */
  userAvatarUrl?: string;
  /** Whether to show the smart action indicator */
  showSmartActionIndicator?: boolean;
  /** Whether the message has an error */
  isError?: boolean;
  /** Called when a follow-up chip is clicked */
  onFollowUpSelect?: (followUp: string) => void;
}

interface LearningMessageSections {
  tldr: string;
  deepDive?: string;
  followUps: string[];
}

const FOLLOW_UP_HEADING_REGEX = /^##\s+Follow-up questions\s*$/i;
const LIST_ITEM_REGEX = /^\s*-\s+(.+)$/;

function normaliseFollowUpText(followUpLine: string): string {
  return followUpLine.trim().replace(/\s+/g, ' ');
}

function parseFollowUpsFromLines(lines: readonly string[]): string[] {
  const parsedFollowUps: string[] = [];
  for (const line of lines) {
    const listMatch = line.match(LIST_ITEM_REGEX);
    if (!listMatch) {
      continue;
    }

    const followUpText = normaliseFollowUpText(listMatch[1]);
    if (followUpText.length === 0) {
      continue;
    }

    parsedFollowUps.push(followUpText);
  }

  return parsedFollowUps;
}

function splitContentByFollowUpHeading(content: string): { body: string; followUps: string[] } {
  const lines = content.split('\n');
  const headingLineIndex = lines.findIndex((line) => FOLLOW_UP_HEADING_REGEX.test(line.trim()));
  if (headingLineIndex < 0) {
    return { body: content, followUps: [] };
  }

  const body = lines.slice(0, headingLineIndex).join('\n').trim();
  const followUpLines = lines.slice(headingLineIndex + 1);
  const followUps = parseFollowUpsFromLines(followUpLines);
  return { body, followUps };
}

function parseLearningMessageSections(content: string): LearningMessageSections | null {
  const trimmedContent = content.trim();
  if (trimmedContent.length === 0) {
    return null;
  }

  const { body: contentWithoutFollowUps, followUps } = splitContentByFollowUpHeading(trimmedContent);
  const contentSections = contentWithoutFollowUps
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  if (contentSections.length < 2) {
    return null;
  }

  const [tldr, ...deepDiveSections] = contentSections;
  const deepDive = deepDiveSections.join('\n\n').trim();
  if (deepDive.length === 0) {
    return null;
  }

  return {
    tldr,
    deepDive,
    followUps,
  };
}

/** Format a duration in ms as a compact "1.2s" / "850ms" string. */
function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Synthesises a complete {@link ToolCallEvent} list from the legacy
 * `toolCalls: string[]` representation, so older persisted messages still get
 * the new rendering.
 */
function legacyEventsFromNames(names: readonly string[]): ToolCallEvent[] {
  return names.map((name, index) => ({
    id: `legacy-${index}-${name}`,
    name,
    status: 'complete',
  }));
}

interface ToolEventRowProps {
  event: ToolCallEvent;
  showDetails: boolean;
}

/**
 * A single row in the tool-event timeline.
 *
 * Renders an icon, human-readable summary, optional duration, and — when the
 * debug toggle is on — a native `<details>` disclosure with raw args/result.
 */
function ToolEventRow({ event, showDetails }: ToolEventRowProps) {
  const { icon, summary } = useMemo(() => toolSummary(event.name, event.args), [event.name, event.args]);
  const isRunning = event.status === 'running';
  const duration = formatDuration(event.durationMs);
  const ariaLabel = isRunning ? `Tool running: ${summary}` : `Tool completed: ${summary}`;
  const argsJson = useMemo(() => {
    try {
      return JSON.stringify(event.args ?? {}, null, 2);
    } catch {
      return String(event.args);
    }
  }, [event.args]);

  return (
    <li
      className={`${styles.toolEvent} ${isRunning ? styles.toolEventRunning : styles.toolEventComplete}`}
      aria-label={ariaLabel}
    >
      <span className={styles.toolEventLine}>
        <span className={styles.toolEventStatus} aria-hidden="true">
          {isRunning ? <Spinner size="small" srText="" /> : <CheckIcon size={14} className={styles.toolEventCheck} />}
        </span>
        <span className={styles.toolEventIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.toolEventSummary}>{summary}</span>
        {duration && !isRunning && <span className={styles.toolEventDuration}>{duration}</span>}
      </span>
      {showDetails && (
        <details className={styles.toolEventDetails}>
          <summary className={styles.toolEventDetailsToggle}>Show details</summary>
          <div className={styles.toolEventDetailsBody}>
            <div className={styles.toolEventDetailsLabel}>tool</div>
            <pre className={styles.toolEventDetailsPre}>{event.name}</pre>
            <div className={styles.toolEventDetailsLabel}>arguments</div>
            <pre className={styles.toolEventDetailsPre}>{argsJson}</pre>
            {event.result !== undefined && (
              <>
                <div className={styles.toolEventDetailsLabel}>result</div>
                <pre className={styles.toolEventDetailsPre}>{event.result}</pre>
              </>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

/**
 * Renders a single chat message with role-based styling.
 *
 * Supports markdown content, code highlighting, streaming state, smart action
 * indicators, and an inline tool-call timeline for MCP/Copilot tools.
 *
 * PERF: Memoized to prevent re-renders when parent state changes.
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
  userAvatarUrl,
  showSmartActionIndicator,
  isError = false,
  onFollowUpSelect,
}: MessageBubbleProps) {
  const { isDebugMode } = useDebugMode();
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const hasActionable = showSmartActionIndicator ?? message.hasActionableItem;

  const displayContent = message.content;
  const learningSections = isAssistant && !isError ? parseLearningMessageSections(displayContent) : null;

  // Prefer the rich timeline; synthesise complete events from the
  // name-only `toolCalls: string[]` for older messages that only
  // carry the legacy shape.
  const resolvedToolEvents: ToolCallEvent[] = (() => {
    if (message.toolEvents?.length) return message.toolEvents;
    if (message.toolCalls?.length) return legacyEventsFromNames(message.toolCalls);
    return [];
  })();

  const runningCount = resolvedToolEvents.filter((e) => e.status === 'running').length;
  const completeCount = resolvedToolEvents.length - runningCount;
  const liveRegionText =
    resolvedToolEvents.length === 0
      ? ''
      : runningCount > 0
        ? `${runningCount} tool${runningCount === 1 ? '' : 's'} running`
        : `${completeCount} tool${completeCount === 1 ? '' : 's'} completed`;

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
            <span className={styles.role}>{isUser ? 'You' : 'Copilot'}</span>
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

          {/* Tool event timeline — surfaced to all users, not just debug mode. */}
          {resolvedToolEvents.length > 0 && (
            <div className={styles.toolEvents}>
              <ul data-testid="tool-event-list" className={styles.toolEventList} aria-label="Tool calls">
                {resolvedToolEvents.map((event) => (
                  <ToolEventRow key={event.id} event={event} showDetails={isDebugMode} />
                ))}
              </ul>
              <span className={styles.srOnly} role="status" aria-live="polite">
                {liveRegionText}
              </span>
            </div>
          )}

          {/* Body */}
          {isError ? (
            <Banner variant="critical" title="Error" hideTitle className={styles.errorBanner}>
              {displayContent}
            </Banner>
          ) : isStreaming && !displayContent ? (
            <div className={styles.loadingState} role="status" aria-live="polite" aria-label="Loading response">
              <SkeletonBox height="3em" />
            </div>
          ) : displayContent ? (
            <div
              className={styles.messageContent}
              role={isStreaming ? 'status' : undefined}
              aria-live={isStreaming ? 'polite' : undefined}
              aria-label={isStreaming ? 'Streaming response' : undefined}
            >
              {learningSections ? (
                <div className={styles.learningLayout}>
                  <MarkdownContent content={learningSections.tldr} />
                  <details className={styles.deepDiveDisclosure} data-testid="learning-deep-dive">
                    <summary className={styles.deepDiveSummary}>Show deep dive</summary>
                    <div className={styles.deepDiveBody}>
                      <MarkdownContent content={learningSections.deepDive ?? ''} />
                    </div>
                  </details>
                  {learningSections.followUps.length > 0 && onFollowUpSelect && (
                    <div className={styles.followUpSection}>
                      <p className={styles.followUpLabel}>Follow-up questions</p>
                      <div className={styles.followUpChipList}>
                        {learningSections.followUps.map((followUp) => (
                          <Button
                            key={followUp}
                            size="small"
                            variant="default"
                            className={styles.followUpChip}
                            onClick={() => onFollowUpSelect(followUp)}
                          >
                            {followUp}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <MarkdownContent content={displayContent} />
              )}
            </div>
          ) : null}

          {/* Performance metrics - STANDARDIZED ORDER: conversation, server→client TTFT flow, total, model, MCP */}
          {isDebugMode && isAssistant && message.perf && !isStreaming && (
            <div className={styles.perfMetrics}>
              {/* 1. Conversation state (shows session creation overhead) */}
              {message.perf.sessionPoolHit !== undefined && (
                <ConversationBadge
                  reused={message.perf.sessionPoolHit}
                  createTimeMs={message.perf.sessionPoolHit ? undefined : (message.perf.sessionCreateMs ?? undefined)}
                />
              )}
              {/* 2. TTFT - Server→Client flow (server time INCLUDES session creation) */}
              <TtftBadges
                serverMs={message.perf.serverFirstTokenMs ?? undefined}
                clientMs={message.perf.clientFirstTokenMs}
              />
              {/* 3. Total time (end-to-end completion) */}
              {message.perf.clientTotalMs !== undefined && (
                <StatusBadge variant="info">Total: {message.perf.clientTotalMs}ms</StatusBadge>
              )}
              {/* 4. Model (metadata) */}
              {message.perf.model && <ModelBadge model={message.perf.model} />}
              {/* 5. MCP tools (feature indicator) */}
              {message.perf.mcpEnabled && <McpToolsBadge />}
            </div>
          )}
        </div>
      </Stack>
    </div>
  );
});
