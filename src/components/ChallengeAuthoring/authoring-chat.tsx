'use client';

/**
 * Authoring Chat Component
 *
 * Chat UI for the challenge authoring conversation.
 * Implements accessibility requirements including list semantics
 * and aria-live announcements (AC10.1, AC10.7).
 *
 * @see SPEC-006 S1, AC1.2, AC1.3 for authoring chat requirements
 */

import { MarkdownContent } from '@/components/MarkdownContent';
import { now, nowMs } from '@/lib/utils/date-utils';
import type { DailyChallenge } from '@/lib/focus/types';
import { CheckIcon, CopilotIcon, PersonIcon } from '@primer/octicons-react';
import { Avatar, Button, Spinner, Stack, Textarea } from '@primer/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import styles from './ChallengeAuthoring.module.css';
import type { TemplateSelection } from './quick-templates';

/**
 * Message in the authoring conversation.
 */
interface AuthoringMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Props for the {@link AuthoringChat} component.
 */
interface AuthoringChatProps {
  /** Selected template (seeds initial prompt) */
  template: TemplateSelection | null;
  /** Existing conversation ID for multi-turn */
  conversationId: string | null;
  /** Callback when conversation ID changes */
  onConversationIdChange: (id: string) => void;
  /** Callback when a challenge is generated and user confirms creation */
  onChallengeGenerated: (challenge: DailyChallenge) => void;
  /** User's avatar URL */
  userAvatarUrl?: string;
}

/**
 * SSE event types from the authoring API.
 */
interface AuthorSSEEvent {
  type: 'delta' | 'challenge' | 'meta' | 'error';
  content?: string;
  challenge?: DailyChallenge;
  conversationId?: string;
  message?: string;
}

/**
 * Authoring chat with streaming conversation support.
 *
 * Uses list semantics (`ul`/`li`) for messages and aria-live
 * for new message announcements.
 */
export const AuthoringChat = forwardRef<HTMLTextAreaElement, AuthoringChatProps>(
  function AuthoringChat(
    {
      template,
      conversationId,
      onConversationIdChange,
      onChallengeGenerated,
      userAvatarUrl,
    },
    ref
  ) {
    const [messages, setMessages] = useState<AuthoringMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [announcement, setAnnouncement] = useState('');
    // Store parsed challenge - only created when user explicitly clicks "Create Challenge"
    const [pendingChallenge, setPendingChallenge] = useState<DailyChallenge | null>(null);

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    // Ref to track if template prompt was already sent (prevents React StrictMode double-execution)
    const templateSentRef: MutableRefObject<boolean> = useRef(false);

    // Expose the input ref for focus management
    useImperativeHandle(ref, () => inputRef.current as HTMLTextAreaElement, []);

    // Auto-send template prompt on mount
    useEffect(() => {
      // Only send if not already sent and no existing messages
      if (template?.initialPrompt && messages.length === 0 && !templateSentRef.current) {
        templateSentRef.current = true;
        sendMessage(template.initialPrompt);
      }
      // NOTE: Intentionally limited deps - we only want to send the template prompt once
      // when the component mounts with a template. Including `messages` would cause
      // re-evaluation on every message update, and `sendMessage` changes identity
      // which would trigger unwanted re-sends. The ref guard handles React StrictMode.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [template]);

    // Scroll to bottom on new messages
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingContent]);

    /**
     * Send a message to the authoring API.
     */
    const sendMessage = useCallback(
      async (content: string) => {
        if (!content.trim() || isStreaming) return;

        // Add user message
        const userMessage: AuthoringMessage = {
          id: `user-${nowMs()}`,
          role: 'user',
          content: content.trim(),
          timestamp: now(),
        };
        setMessages((prev) => [...prev, userMessage]);
        setInputValue('');
        setIsStreaming(true);
        setStreamingContent('');
        setAnnouncement('Copilot is thinking...');

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController();

        try {
          const response = await fetch('/api/challenge/author', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: content.trim(),
              conversationId,
              context: template
                ? {
                    template: template.name,
                    difficulty: template.difficulty,
                    language: template.language,
                  }
                : undefined,
            }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let fullContent = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const event: AuthorSSEEvent = JSON.parse(data);

                if (event.type === 'delta' && event.content) {
                  fullContent += event.content;
                  setStreamingContent(fullContent);
                } else if (event.type === 'challenge' && event.challenge) {
                  // Store the parsed challenge - don't auto-create, let user confirm
                  setPendingChallenge(event.challenge);
                } else if (event.type === 'meta' && event.conversationId) {
                  onConversationIdChange(event.conversationId);
                } else if (event.type === 'error') {
                  throw new Error(event.message || 'Unknown error');
                }
              } catch {
                // Skip invalid JSON lines
              }
            }
          }

          // Add assistant message
          if (fullContent) {
            const assistantMessage: AuthoringMessage = {
              id: `assistant-${nowMs()}`,
              role: 'assistant',
              content: fullContent,
              timestamp: now(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setAnnouncement('Copilot responded');
          }
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            setAnnouncement('Response stopped');
          } else {
            const errorMessage: AuthoringMessage = {
              id: `error-${nowMs()}`,
              role: 'assistant',
              content: `Sorry, I encountered an error: ${(error as Error).message}. Please try again.`,
              timestamp: now(),
            };
            setMessages((prev) => [...prev, errorMessage]);
            setAnnouncement('Error occurred');
          }
        } finally {
          setIsStreaming(false);
          setStreamingContent('');
          abortControllerRef.current = null;
        }
      },
      [conversationId, template, isStreaming, onConversationIdChange]
    );

    /**
     * Handle form submission.
     */
    const handleSubmit = useCallback(
      (e: React.FormEvent) => {
        e.preventDefault();
        sendMessage(inputValue);
      },
      [inputValue, sendMessage]
    );

    /**
     * Handle keyboard shortcuts.
     */
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(inputValue);
        }
      },
      [inputValue, sendMessage]
    );

    /**
     * Stop streaming response.
     */
    const handleStop = useCallback(() => {
      abortControllerRef.current?.abort();
    }, []);

    /**
     * Handle creating the challenge when user confirms.
     */
    const handleCreateChallenge = useCallback(() => {
      if (pendingChallenge) {
        onChallengeGenerated(pendingChallenge);
      }
    }, [pendingChallenge, onChallengeGenerated]);

    return (
      <div className={styles.chatContainer}>
        {/* Screen reader announcements */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={styles.srOnly}
        >
          {announcement}
        </div>

        {/* Messages area */}
        <div className={styles.messagesArea}>
          {messages.length === 0 && !isStreaming ? (
            <div className={styles.emptyChat}>
              <div className={styles.emptyChatIcon}>
                <CopilotIcon size={48} />
              </div>
              <h2 className={styles.emptyChatTitle}>
                Describe your challenge
              </h2>
              <p className={styles.emptyChatDescription}>
                Tell me what kind of challenge you want to create. I&apos;ll ask
                clarifying questions and help you design it.
              </p>
            </div>
          ) : (
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
          )}
        </div>

        {/* Input area */}
        <form onSubmit={handleSubmit} className={styles.inputArea}>
          <div className={styles.inputWrapper}>
            <Textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your challenge idea..."
              disabled={isStreaming}
              rows={2}
              resize="vertical"
              block
              aria-label="Challenge description"
            />
          </div>
          <Stack direction="vertical" gap="condensed">
            {isStreaming ? (
              <Button variant="danger" onClick={handleStop} aria-label="Stop generating">
                <Spinner size="small" />
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                disabled={!inputValue.trim()}
              >
                Send
              </Button>
            )}
          </Stack>
        </form>

        {/* Create Challenge button - only shown when a challenge is ready */}
        {pendingChallenge && !isStreaming && (
          <div className={styles.createChallengeBar}>
            <Stack direction="horizontal" align="center" justify="space-between" gap="normal">
              <span className={styles.challengeReadyText}>
                ✨ Challenge ready: <strong>{pendingChallenge.title}</strong>
              </span>
              <Button variant="primary" onClick={handleCreateChallenge}>
                <CheckIcon size={16} />
                Create Challenge
              </Button>
            </Stack>
          </div>
        )}
      </div>
    );
  }
);
