'use client';

import { PaperAirplaneIcon, StopIcon } from '@primer/octicons-react';
import { FormControl, IconButton, Stack, Textarea } from '@primer/react';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import styles from './ChatInput.module.css';

/**
 * Props for the {@link ChatInput} component.
 */
export interface ChatInputProps {
  /** Callback when a message is submitted */
  onSend: (message: string) => void;
  /** Whether the input is disabled (e.g., during streaming) */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Maximum character length */
  maxLength?: number;
  /** Whether streaming is in progress (shows stop button) */
  isStreaming?: boolean;
  /** Callback when stop is clicked */
  onStop?: () => void;
}

/**
 * Chat input component with auto-resize and keyboard shortcuts.
 * 
 * Supports Enter to submit (with Shift+Enter for newlines),
 * auto-resizing textarea, and character count indicator.
 * 
 * @example
 * ```tsx
 * <ChatInput
 *   onSend={handleSendMessage}
 *   disabled={isStreaming}
 *   placeholder="Ask about your code..."
 * />
 * ```
 */
export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type your message...',
  maxLength = 4000,
  isStreaming = false,
  onStop,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmedValue = value.trim();
    if (!trimmedValue || disabled) return;
    
    onSend(trimmedValue);
    setValue('');
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (newValue.length <= maxLength) {
      setValue(newValue);
    }
    
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [maxLength]);

  const canSubmit = value.trim().length > 0 && !disabled;
  const charCount = value.length;
  const showCharCount = charCount > maxLength * 0.8;

  return (
    <div className={styles.container}>
      <FormControl disabled={disabled}>
        <FormControl.Label visuallyHidden>Message input</FormControl.Label>
        <Stack direction="horizontal" gap="condensed" align="center">
          <div className={styles.textareaWrapper}>
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              block
              resize="none"
              className={styles.textarea}
              aria-label="Type your message"
            />
            {showCharCount && (
              <span 
                className={`${styles.charCount} ${charCount >= maxLength ? styles.charCountLimit : ''}`}
                aria-live="polite"
              >
                {charCount}/{maxLength}
              </span>
            )}
          </div>
          {isStreaming && onStop ? (
            <IconButton
              icon={StopIcon}
              aria-label="Stop generating"
              variant="danger"
              size="medium"
              onClick={onStop}
              className={styles.sendButton}
            />
          ) : (
            <IconButton
              icon={PaperAirplaneIcon}
              aria-label={canSubmit ? 'Send message (Enter)' : 'Type a message to send'}
              variant="primary"
              size="medium"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className={styles.sendButton}
            />
          )}
        </Stack>
        <FormControl.Caption className={styles.caption}>
          Press Enter to send, Shift+Enter for new line
        </FormControl.Caption>
      </FormControl>
    </div>
  );
}

