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

import { AlertIcon, BeakerIcon, CheckCircleIcon, SignInIcon, XCircleIcon } from '@primer/octicons-react';
import { Button, SkeletonBox } from '@primer/react';
import dynamic from 'next/dynamic';
import remarkGfm from 'remark-gfm';

// Lazy load markdown rendering to reduce bundle size
const ReactMarkdown = dynamic(() => import('react-markdown'), {
  loading: () => <SkeletonBox height="3em" />,
});

import type { EvaluationErrorCode, EvaluationState } from '@/hooks/use-challenge-sandbox';

import styles from './ChallengeSandbox.module.css';

/**
 * Error codes that should surface the re-auth call-to-action instead of
 * a generic error message.
 */
const CREDENTIALS_EXPIRED_CODES: readonly EvaluationErrorCode[] = [
  'credentials_missing',
  'credentials_refresh_failed',
];

/** Props for EvaluationResultDisplay */
interface EvaluationResultDisplayProps {
  /** Current evaluation state with streaming data */
  evaluation: EvaluationState;
}

/**
 * Step narration shown above the skeleton while we wait for the first
 * partial result. Wrapping the label in an `aria-live="polite"` region
 * lets screen readers announce transitions naturally; React's keyed
 * reconciliation already prevents redundant DOM updates when the value
 * is unchanged across polls.
 */
function StepNarration({ step }: { step: string }) {
  return (
    <div className={styles.stepNarration} role="status" aria-live="polite">
      <span className={styles.stepNarrationIcon} aria-hidden="true">
        ⏳
      </span>
      <span>{step}</span>
    </div>
  );
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
  const {
    isLoading,
    partialResult,
    streamingFeedback,
    result,
    error,
    errorCode,
    currentStep,
  } = evaluation;

  // Credentials-expired UX takes precedence: route the user to re-auth
  // instead of showing a generic error.
  if (errorCode && CREDENTIALS_EXPIRED_CODES.includes(errorCode)) {
    const callbackUrl = typeof window !== 'undefined' ? window.location.pathname : '/';
    return (
      <div className={styles.reAuthPrompt} role="alert">
        <div className={styles.emptyIcon}>
          <AlertIcon size={24} />
        </div>
        <p className={styles.emptyText}>
          <strong>Your GitHub session expired.</strong> Sign in again to keep your evaluation running.
        </p>
        <Button
          as="a"
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          variant="primary"
          leadingVisual={SignInIcon}
        >
          Sign in with GitHub
        </Button>
      </div>
    );
  }

  // Generic failure (e.g. provider error, parsing failure) without a
  // structured errorCode falls through to a plain error banner.
  if (error && !isLoading && !result) {
    return (
      <div className={styles.emptyState} role="alert">
        <div className={styles.emptyIcon}>
          <XCircleIcon size={24} />
        </div>
        <p className={styles.emptyText}>{error}</p>
      </div>
    );
  }

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

  // While loading but no partial result yet, show step narration + skeleton
  if (isLoading && !partialResult) {
    return (
      <div className={styles.emptyState}>
        {currentStep && <StepNarration step={currentStep} />}
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
      {/* Step narration while streaming continues after the partial arrives */}
      {isLoading && currentStep && <StepNarration step={currentStep} />}

      {/* Perfect score completion message */}
      {isPerfectScore && (
        <div 
          className={`${styles.completionBanner} ${styles.resultReveal}`} 
          data-delay="0"
          role="status"
          aria-live="polite"
        >
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
        role="status"
        aria-live="polite"
        aria-label={`Evaluation result: ${displayResult.isCorrect ? 'Correct' : 'Not quite'}${displayResult.score !== undefined ? `, score ${displayResult.score}%` : ''}`}
      >
        {displayResult.isCorrect ? (
          <>
            <CheckCircleIcon size={16} aria-hidden="true" />
            Correct!
          </>
        ) : (
          <>
            <XCircleIcon size={16} aria-hidden="true" />
            Not quite
          </>
        )}
        {displayResult.score !== undefined && <span>({displayResult.score}%)</span>}
      </div>

      {/* Feedback text - streams in real-time or shows final */}
      {feedbackText && (
        <div 
          className={`${styles.feedback} ${isStreamingFeedback ? styles.feedbackStreaming : ''}`}
          role="region"
          aria-live="polite"
          aria-label="Evaluation feedback"
        >
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
