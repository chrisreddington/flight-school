'use client';

/**
 * Authoring Input Form Component
 *
 * Handles user input for the authoring chat with keyboard shortcuts
 * and streaming state management.
 */

import { Button, Spinner, Stack, Textarea } from '@primer/react';
import styles from './ChallengeAuthoring.module.css';

interface AuthoringInputFormProps {
  inputValue: string;
  isStreaming: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onStop: () => void;
}

/**
 * Input form component for the authoring chat.
 * Provides textarea input with send/stop controls based on streaming state.
 */
export function AuthoringInputForm({
  inputValue,
  isStreaming,
  inputRef,
  onInputChange,
  onSubmit,
  onKeyDown,
  onStop,
}: AuthoringInputFormProps) {
  return (
    <form onSubmit={onSubmit} className={styles.inputArea}>
      <div className={styles.inputWrapper}>
        <Textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
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
          <Button variant="danger" onClick={onStop} aria-label="Stop generating">
            <Spinner size="small" />
            Stop
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={!inputValue.trim()}>
            Send
          </Button>
        )}
      </Stack>
    </form>
  );
}
