/**
 * ResultsPanel subcomponent
 *
 * Renders the right-hand column of the sandbox: a collapsible evaluation
 * section (run / evaluate / stop / reset actions, streamed evaluation result,
 * self-explanation prompt, related suggestions) and a collapsible hints
 * section.
 *
 * Extracted from `ChallengeSandbox` to keep the parent focused on
 * orchestration. All collapse and action state still lives in the parent so
 * behavior is unchanged.
 */

import type { EvaluationState, HintMessage } from '@/hooks/use-challenge-sandbox';
import type { ChallengeDef, EvaluationResult } from '@/lib/copilot/types';
import { logger } from '@/lib/logger';
import {
  BeakerIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LightBulbIcon,
  PlayIcon,
  SkipIcon,
} from '@primer/octicons-react';
import { Button } from '@primer/react';
import styles from './ChallengeSandbox.module.css';
import { EvaluationResultDisplay } from './evaluation-result-display';
import { HintDisplay } from './hint-display';
import { RelatedSuggestions } from './RelatedSuggestions';
import { SelfExplanationCard } from './self-explanation-card';

export interface ResultsPanelProps {
  challenge: ChallengeDef;
  challengeId: string;
  dateKey: string;
  evaluation: EvaluationState;
  evaluationResult: EvaluationResult | null;
  isEvaluating: boolean;
  isEvaluationCollapsed: boolean;
  onToggleEvaluationCollapsed: () => void;
  onOpenResetDialog: () => void;
  onStopEvaluation: () => void;
  onRunCode: () => void;
  onEvaluate: () => void;
  isRunning: boolean;
  canRunInBrowser: boolean;
  canEvaluate: boolean;
  isRateLimited: boolean;
  rateLimitRetryInSeconds: number | null;
  showSelfExplanationCard: boolean;
  onSaveSelfExplanation: (text: string) => Promise<void>;
  onSkipSelfExplanation: () => void;
  hints: HintMessage[];
  isLoadingHint: boolean;
  hintError: string | null;
  onRequestHint: (question: string) => Promise<void>;
  onStopHint: () => void;
  isHintsCollapsed: boolean;
  onToggleHintsCollapsed: () => void;
}

export function ResultsPanel({
  challenge,
  challengeId,
  dateKey,
  evaluation,
  evaluationResult,
  isEvaluating,
  isEvaluationCollapsed,
  onToggleEvaluationCollapsed,
  onOpenResetDialog,
  onStopEvaluation,
  onRunCode,
  onEvaluate,
  isRunning,
  canRunInBrowser,
  canEvaluate,
  isRateLimited,
  rateLimitRetryInSeconds,
  showSelfExplanationCard,
  onSaveSelfExplanation,
  onSkipSelfExplanation,
  hints,
  isLoadingHint,
  hintError,
  onRequestHint,
  onStopHint,
  isHintsCollapsed,
  onToggleHintsCollapsed,
}: ResultsPanelProps) {
  const evaluationClassName = [
    styles.evaluationSection,
    isEvaluationCollapsed ? styles.collapsed : '',
    isHintsCollapsed && !isEvaluationCollapsed ? styles.expanded : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.rightPanel}>
      {/* Evaluation section */}
      <div className={evaluationClassName}>
        <div className={styles.sectionHeader}>
          <button
            className={styles.sectionHeaderToggle}
            onClick={onToggleEvaluationCollapsed}
            aria-expanded={!isEvaluationCollapsed}
            aria-label={`${isEvaluationCollapsed ? 'Expand' : 'Collapse'} evaluation section`}
          >
            {isEvaluationCollapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />}
            <span className={styles.sectionIcon}>
              <BeakerIcon size={16} />
            </span>
            <h3 className={styles.sectionTitle}>Evaluation</h3>
          </button>
          <div className={styles.sectionHeaderRight}>
            <Button
              variant="invisible"
              size="small"
              onClick={onOpenResetDialog}
              leadingVisual={SkipIcon}
              disabled={isEvaluating}
              aria-label="Reset code and evaluation results"
            >
              Reset
            </Button>
            {isEvaluating ? (
              <Button
                variant="danger"
                size="small"
                onClick={onStopEvaluation}
                disabled={evaluation.isCancelling}
                aria-label={evaluation.isCancelling ? 'Cancelling evaluation' : 'Stop evaluation'}
              >
                {evaluation.isCancelling ? 'Cancelling…' : 'Stop'}
              </Button>
            ) : (
              <>
                <Button
                  variant="default"
                  size="small"
                  onClick={onRunCode}
                  disabled={!canRunInBrowser || isRunning}
                  aria-label="Run code in browser"
                >
                  {isRunning ? 'Running...' : '▷ Run'}
                </Button>
                <Button
                  variant="primary"
                  size="small"
                  onClick={onEvaluate}
                  leadingVisual={PlayIcon}
                  disabled={!canEvaluate || isRateLimited}
                  aria-label={
                    isRateLimited
                      ? `Evaluation paused. Retry in ${rateLimitRetryInSeconds}s`
                      : 'Evaluate code solution'
                  }
                >
                  {isRateLimited ? `Retry in ${rateLimitRetryInSeconds}s` : 'Evaluate'}
                </Button>
              </>
            )}
          </div>
        </div>
        {!isEvaluationCollapsed && (
          <>
            <EvaluationResultDisplay evaluation={evaluation} />
            {showSelfExplanationCard && (
              <SelfExplanationCard
                challengeId={challengeId}
                dateKey={dateKey}
                onSave={onSaveSelfExplanation}
                onSkip={onSkipSelfExplanation}
              />
            )}
            {evaluationResult?.isCorrect === true && (
              <RelatedSuggestions
                completedChallenge={{
                  title: challenge.title,
                  language: challenge.language,
                  difficulty: challenge.difficulty,
                }}
                onSelectSuggestion={(suggestion) => {
                  logger.info(
                    'Related suggestion selected',
                    { suggestionTitle: suggestion.title },
                    'ChallengeSandbox',
                  );
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Hints section */}
      <div className={`${styles.hintSection} ${isHintsCollapsed ? styles.collapsed : ''}`}>
        <div className={styles.sectionHeader}>
          <button
            className={styles.sectionHeaderToggle}
            onClick={onToggleHintsCollapsed}
            aria-expanded={!isHintsCollapsed}
            aria-label={`${isHintsCollapsed ? 'Expand' : 'Collapse'} hints section`}
          >
            {isHintsCollapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />}
            <span className={styles.sectionIcon}>
              <LightBulbIcon size={16} />
            </span>
            <h3 className={styles.sectionTitle}>Hints ({hints.length})</h3>
          </button>
        </div>
        {!isHintsCollapsed && (
          <HintDisplay
            hints={hints}
            isLoading={isLoadingHint}
            error={hintError}
            onRequestHint={onRequestHint}
            onStopHint={onStopHint}
          />
        )}
      </div>
    </div>
  );
}
