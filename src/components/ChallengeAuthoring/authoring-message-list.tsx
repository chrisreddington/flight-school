'use client';

/**
 * Authoring Message List Component
 *
 * Displays the conversation history with proper list semantics
 * and accessibility requirements (AC10.1, AC10.7).
 */

import { MarkdownContent } from '@/components/MarkdownContent';
import { CheckIcon, CopilotIcon, PersonIcon } from '@primer/octicons-react';
import { Avatar, Button, Stack } from '@primer/react';
import type { DailyChallenge } from '@/lib/focus/types';
import styles from './ChallengeAuthoring.module.css';
import type { AuthoringMessage } from './authoring-chat';

interface AuthoringMessageListProps {
  messages: AuthoringMessage[];
  isStreaming: boolean;
  streamingContent: string;
  userAvatarUrl?: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  pendingChallenge: DailyChallenge | null;
  onCreateChallenge: () => void;
}

/**
 * Message list component for the authoring chat.
 * Renders conversation history with avatars and proper semantic structure.
 */
export function AuthoringMessageList({
  messages,
  isStreaming,
  streamingContent,
  userAvatarUrl,
  messagesEndRef,
  pendingChallenge,
  onCreateChallenge,
}: AuthoringMessageListProps) {
  // Show empty state when no messages and not streaming
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className={styles.emptyChat}>
        <div className={styles.emptyChatIcon}>
          <CopilotIcon size={48} />
        </div>
        <h2 className={styles.emptyChatTitle}>Describe your challenge</h2>
        <p className={styles.emptyChatDescription}>
          Tell me what kind of challenge you want to create. I&apos;ll ask
          clarifying questions and help you design it.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className={styles.messageList} aria-label="Conversation">
        {messages.map((message) => (
          <li key={message.id} className={styles.message}>
            <div className={styles.messageAvatar}>
              {message.role === 'user' ? (
                userAvatarUrl ? (
                  <Avatar src={userAvatarUrl} size={32} alt="You" />
                ) : (
                  <div className={styles.messageAvatarUser}>
                    <PersonIcon size={16} />
                  </div>
                )
              ) : (
                <div className={styles.messageAvatarAssistant}>
                  <CopilotIcon size={16} />
                </div>
              )}
            </div>
            <div
              className={`${styles.messageContent} ${
                message.role === 'user' ? styles.messageContentUser : ''
              }`}
            >
              {message.role === 'assistant' ? (
                <MarkdownContent content={message.content} />
              ) : (
                message.content
              )}
            </div>
          </li>
        ))}
        {isStreaming && !streamingContent && (
          <li className={styles.message}>
            <div className={styles.messageAvatar}>
              <div className={styles.messageAvatarAssistant}>
                <CopilotIcon size={16} />
              </div>
            </div>
            <div className={styles.messageContent}>
              <div className={styles.typingIndicator} aria-label="Copilot is thinking" role="status">
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </div>
            </div>
          </li>
        )}
        {isStreaming && streamingContent && (
          <li className={styles.message}>
            <div className={styles.messageAvatar}>
              <div className={styles.messageAvatarAssistant}>
                <CopilotIcon size={16} />
              </div>
            </div>
            <div className={styles.messageContent}>
              <MarkdownContent content={streamingContent} isStreaming />
            </div>
          </li>
        )}
        <div ref={messagesEndRef} />
      </ul>

      {/* Create Challenge button - only shown when a challenge is ready */}
      {pendingChallenge && !isStreaming && (
        <div className={styles.createChallengeBar}>
          <Stack
            direction="horizontal"
            align="center"
            justify="space-between"
            gap="normal"
          >
            <span className={styles.challengeReadyText}>
              ✨ Challenge ready: <strong>{pendingChallenge.title}</strong>
            </span>
            <Button variant="primary" onClick={onCreateChallenge}>
              <CheckIcon size={16} />
              Create Challenge
            </Button>
          </Stack>
        </div>
      )}
    </>
  );
}
