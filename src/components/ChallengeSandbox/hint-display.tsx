/**
 * HintDisplay Component
 *
 * Displays hint conversation history and input for requesting new hints.
 * Part of the progressive hints system for challenge sandbox.
 *
 * @see SPEC-002 AC3.1-AC3.4 for hint system requirements
 */

'use client';

import { LightBulbIcon, StopIcon } from '@primer/octicons-react';
import { Button, Spinner, Stack, TextInput } from '@primer/react';
import { useCallback, useState } from 'react';

import type { HintMessage } from '@/hooks/use-challenge-sandbox';

import styles from './ChallengeSandbox.module.css';

/** Props for HintDisplay */
interface HintDisplayProps {
  /** Hint conversation history */
  hints: HintMessage[];
  /** Whether a hint request is in progress */
  isLoading: boolean;
  /** Error message if hint request failed */
  error: string | null;
  /** Callback to request a new hint */
  onRequestHint: (question: string) => void;
  /** Callback to stop the current hint request */
  onStopHint?: () => void;
}

/**
 * Displays the hint conversation and input area.
 *
 * Shows hint history with questions and responses,
 * and provides an input for requesting new hints.
 */
export function HintDisplay({
  hints,
  isLoading,
  error,
  onRequestHint,
  onStopHint,
}: HintDisplayProps) {
  const [question, setQuestion] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (question.trim() && !isLoading) {
        onRequestHint(question.trim());
        setQuestion('');
      }
    },
    [question, isLoading, onRequestHint]
  );

  return (
    <>
      {/* Hint messages */}
      <div className={styles.hintMessages} role="log" aria-label="Hint history">
        {hints.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <LightBulbIcon size={24} />
            </div>
            <p className={styles.emptyText}>
              Stuck? Ask for a hint below
            </p>
          </div>
        ) : (
          hints.map((hint) => (
            <div key={hint.id} className={styles.hintMessage}>
              <div className={styles.hintQuestion}>Q: {hint.question}</div>
              <div className={styles.hintText}>{hint.response.hint}</div>
              {hint.response.concepts && hint.response.concepts.length > 0 && (
                <div className={styles.hintConcepts} role="list" aria-label="Related concepts">
                  {hint.response.concepts.map((concept) => (
                    <span key={`${hint.id}-${concept}`} className={styles.conceptTag} role="listitem">
                      {concept}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className={styles.hintMessage} role="status" aria-live="polite" aria-label="Loading hint">
            <Stack direction="horizontal" align="center" justify="space-between">
              <div className={styles.loading}>
                <Spinner size="small" aria-hidden="true" />
                <span>Getting hint...</span>
              </div>
              {onStopHint && (
                <Button
                  variant="danger"
                  size="small"
                  onClick={onStopHint}
                  leadingVisual={StopIcon}
                  aria-label="Stop getting hint"
                >
                  Stop
                </Button>
              )}
            </Stack>
          </div>
        )}

        {error && (
          <div className={styles.hintMessage} role="alert" aria-live="assertive">
            <div className={styles.hintTextError}>
              {error}
            </div>
          </div>
        )}
      </div>

      {/* Hint input */}
      <form onSubmit={handleSubmit} className={styles.hintInputArea}>
        <TextInput
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question..."
          block
          disabled={isLoading}
          aria-label="Ask for a hint"
        />
      </form>
    </>
  );
}
