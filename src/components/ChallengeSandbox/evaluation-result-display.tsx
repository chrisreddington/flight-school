/**
 * EvaluationResultDisplay Component
 *
 * Displays evaluation results with real-time streaming.
 * Shows badge/lists immediately when partial result arrives,
 * then streams feedback text as it comes in.
 *
 * @see SPEC-002 AC2.1-AC2.4 for evaluation display requirements
 */

'use client';

import { BeakerIcon, CheckCircleIcon, XCircleIcon } from '@primer/octicons-react';
import { SkeletonBox } from '@primer/react';
import dynamic from 'next/dynamic';
import remarkGfm from 'remark-gfm';

// Lazy load markdown rendering to reduce bundle size
const ReactMarkdown = dynamic(() => import('react-markdown'), {
  loading: () => <SkeletonBox height="3em" />,
});

import type { EvaluationState } from '@/hooks/use-challenge-sandbox';

import styles from './ChallengeSandbox.module.css';

/** Props for EvaluationResultDisplay */
export interface EvaluationResultDisplayProps {
  /** Current evaluation state with streaming data */
  evaluation: EvaluationState;
}

/**
 * Displays the evaluation result with real-time streaming.
 *
 * Shows badge/lists immediately when partial result arrives,
 * then streams feedback text as it comes in.
 */
export function EvaluationResultDisplay({
  evaluation,
}: EvaluationResultDisplayProps) {
  const { isLoading, partialResult, streamingFeedback, result } = evaluation;

  // Show empty state when not loading and no result
  if (!isLoading && !result && !partialResult) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>
          <BeakerIcon size={24} />
        </div>
        <p className={styles.emptyText}>
          Run your code to see evaluation results
        </p>
      </div>
    );
  }

  // While loading but no partial result yet, show spinner
  if (isLoading && !partialResult) {
    return (
      <div className={styles.emptyState}>
        <SkeletonBox height="8em" />
      </div>
    );
  }

  // Determine what to show - prefer final result, fall back to partial
  const displayResult = result || partialResult;
  if (!displayResult) {
    return null;
  }

  // Determine feedback text - prefer final, fall back to streaming
  const feedbackText = result?.feedback || streamingFeedback;
  const isStreamingFeedback = isLoading && !result && streamingFeedback.length > 0;

  // Check if this is a perfect score (100%)
  const isPerfectScore = displayResult.isCorrect && displayResult.score === 100;

  return (
    <div className={styles.sectionBody}>
      {/* Perfect score completion message */}
      {isPerfectScore && (
        <div className={`${styles.completionBanner} ${styles.resultReveal}`} data-delay="0">
          <CheckCircleIcon size={16} />
          <span>
            <strong>Challenge Complete!</strong> You solved this challenge with a perfect score.
          </span>
        </div>
      )}

      {/* Result badge - appears immediately */}
      <div
        className={`${styles.resultBadge} ${styles.resultReveal} ${displayResult.isCorrect ? styles.correct : styles.incorrect}`}
        data-delay="0"
      >
        {displayResult.isCorrect ? (
          <>
            <CheckCircleIcon size={16} />
            Correct!
          </>
        ) : (
          <>
            <XCircleIcon size={16} />
            Not quite
          </>
        )}
        {displayResult.score !== undefined && <span>({displayResult.score}%)</span>}
      </div>

      {/* Feedback text - streams in real-time or shows final */}
      {feedbackText && (
        <div className={`${styles.feedback} ${isStreamingFeedback ? styles.feedbackStreaming : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedbackText}</ReactMarkdown>
        </div>
      )}

      {/* Strengths - appears with partial result */}
      {displayResult.strengths.length > 0 && (
        <div className={`${styles.listSection} ${styles.resultReveal}`} data-delay="1">
          <div className={styles.listLabel}>Strengths</div>
          <ul className={styles.list}>
            {displayResult.strengths.map((s) => (
              <li key={`strength-${s.slice(0, 30)}`} className={styles.listItem}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Improvements */}
      {displayResult.improvements.length > 0 && (
        <div className={`${styles.listSection} ${styles.resultReveal}`} data-delay="2">
          <div className={styles.listLabel}>To improve</div>
          <ul className={styles.list}>
            {displayResult.improvements.map((s) => (
              <li key={`improvement-${s.slice(0, 30)}`} className={styles.listItem}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next steps */}
      {displayResult.nextSteps && displayResult.nextSteps.length > 0 && (
        <div className={`${styles.listSection} ${styles.resultReveal}`} data-delay="3">
          <div className={styles.listLabel}>Next steps</div>
          <ul className={styles.list}>
            {displayResult.nextSteps.map((s) => (
              <li key={`nextstep-${s.slice(0, 30)}`} className={styles.listItem}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
