/**
 * ChallengeSandbox Component
 *
 * Interactive coding challenge sandbox with:
 * - Code editor for writing solutions
 * - AI-powered evaluation with streaming feedback
 * - Progressive hints system
 * - Accessibility support (keyboard navigation, ARIA)
 *
 * @see SPEC-002 for challenge sandbox requirements (AC2.1-AC2.4, AC3.1-AC3.4)
 *
 * @example
 * ```tsx
 * <ChallengeSandbox
 *   challenge=\{\{
 *     title: 'Reverse a String',
 *     description: 'Write a function that reverses a string.',
 *     language: 'TypeScript',
 *     difficulty: 'beginner',
 *   \}\}
 *   onComplete=\{(result) => handleComplete(result)\}
 * />
 * ```
 */

'use client';

import { useChallengeSandbox } from '@/hooks/use-challenge-sandbox';
import { useGuidedPlan } from '@/hooks/use-guided-plan';
import { useRateLimitCountdown } from '@/hooks/use-rate-limit-countdown';
import { focusStore } from '@/lib/focus';
import type { RunResult } from '@/lib/editor/code-runner';
import { runCode } from '@/lib/editor/code-runner';
import { getLanguageDisplayName, getMonacoLanguageFromExtension } from '@/lib/editor/monaco-language-map';
import { logger } from '@/lib/logger';
import { getDateKey } from '@/lib/utils/date-utils';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import {
    CodeIcon,
    ScreenFullIcon,
    ScreenNormalIcon,
} from '@primer/octicons-react';
import { Banner, ConfirmationDialog, IconButton, useTheme } from '@primer/react';
import dynamic from 'next/dynamic';
import React, { useCallback, useState } from 'react';

// Lazy load Monaco Editor (2MB+) to avoid blocking initial page load
// PERF: Use loading placeholder with exact dimensions to avoid layout shift
// PERF: Set ssr: false to prevent hydration issues and reduce server bundle
const Editor = dynamic(() => import('@monaco-editor/react'), {
  loading: () => (
    <div className={styles.editorLoadingPlaceholder}>
      Loading editor...
    </div>
  ),
  ssr: false,
});

import { useDebugMode } from '@/contexts/debug-context';
import styles from './ChallengeSandbox.module.css';
import { ChallengeHeader } from './ChallengeHeader';
import { ExportToGitHubDialog } from './export-dialog';
import { FileManager } from './file-manager';
import { ResultsPanel } from './ResultsPanel';
import { CodeOutputPanel } from './CodeOutputPanel';
import { GuidedModePanel } from './GuidedModePanel';
import type { ChallengeSandboxProps } from './types';
import {
  MONACO_KEYBINDING_RUN,
  configureMonacoLanguageDefaults,
  getMonacoEditorOptions,
  getMonacoTheme,
  initializeMonacoLanguageDefaults,
} from './monaco-config';
import { useDeferredEditorMount } from './use-deferred-editor-mount';

initializeMonacoLanguageDefaults();

// ============================================================================
// Main Component
// ============================================================================

/**
 * Interactive challenge sandbox component.
 *
 * Features:
 * - Monaco code editor with syntax highlighting
 * - Real-time AI evaluation with streaming feedback
 * - Progressive hint system
 * - Keyboard shortcuts (Cmd/Ctrl+Enter to run)
 */
export function ChallengeSandbox({
  challengeId,
  challenge,
  onComplete,
  autoFocus = false,
}: ChallengeSandboxProps) {
  const { colorMode } = useTheme();
  const { isDebugMode } = useDebugMode();
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false);
  const [isEvaluationCollapsed, setIsEvaluationCollapsed] = useState(false);
  const [isHintsCollapsed, setIsHintsCollapsed] = useState(false);
  const [isDescriptionCollapsed, setIsDescriptionCollapsed] = useState(true);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [mode, setMode] = useState<'free' | 'guided'>('free');
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasPromptedSelfExplanation, setHasPromptedSelfExplanation] = useState(false);

  const isEditorReady = useDeferredEditorMount();
  
  const {
    workspace,
    evaluation,
    isEvaluating,
    evaluationResult,
    hints,
    isLoadingHint,
    hintError,
    evaluate,
    stopEvaluation,
    requestHint,
    stopHint,
    reset,
    solveChallengeWithAI,
    isSolving,
    solveError,
  } = useChallengeSandbox(challengeId, challenge);

  // Pre-fetch guided plan in background so it's ready when user opens Guided Mode
  const { plan: guidedPlan, loading: isGuidedPlanLoading } = useGuidedPlan(challengeId, challenge);
  const { disabled: isRateLimited, retryInSeconds: rateLimitRetryInSeconds } =
    useRateLimitCountdown();

  // Get active file for language detection
  const activeFile = workspace.files.find((f) => f.id === workspace.activeFileId);
  const activeFileName = activeFile?.name ?? 'solution.ts';
  const editorCode = activeFile?.content ?? '';
  const activeFileExtension = activeFileName.split('.').pop() ?? '';
  const activeFileLanguage = getMonacoLanguageFromExtension(activeFileExtension);
  const activeFileLanguageDisplay = getLanguageDisplayName(activeFileLanguage);
  const canRunInBrowser = ['javascript', 'typescript'].includes(challenge.language.toLowerCase());
  const dateKey = getDateKey();
  const isChallengeComplete = evaluationResult?.score === 100 || evaluationResult?.isCorrect === true;
  const showSelfExplanationCard = isChallengeComplete && !hasPromptedSelfExplanation;

  // Handle reset confirmation dialog
  const handleResetDialogClose = useCallback((gesture: 'confirm' | 'close-button' | 'cancel' | 'escape') => {
    setIsResetDialogOpen(false);
    if (gesture === 'confirm') {
      reset();
    }
  }, [reset]);

  // Configure TypeScript compiler options for ES module mode before editor mounts.
  // Without this, Monaco defaults to module:None (script mode) which treats
  // `export` as a syntax error.
  const handleBeforeMount = useCallback<BeforeMount>((monaco) => {
    configureMonacoLanguageDefaults(monaco);
  }, []);

  // Handle Monaco editor mount for keyboard shortcuts
  const handleEditorMount = useCallback<OnMount>(
    (editor, monaco) => {
      // Belt-and-suspenders: re-apply compiler options after mount to trigger
      // re-validation in case the TypeScript worker initialized before beforeMount fired.
      configureMonacoLanguageDefaults(monaco);
      // Add Cmd/Ctrl+Enter keybinding to run evaluation
      editor.addCommand(
        MONACO_KEYBINDING_RUN,
        () => {
          if (!isEvaluating) {
            void evaluate();
          }
        }
      );
      if (autoFocus) {
        editor.focus();
      }
    },
    [evaluate, isEvaluating, autoFocus]
  );

  // Call onComplete when solution is correct
  const handleEvaluate = useCallback(async () => {
    await evaluate();
    // Check result after evaluation completes
    // Note: The result will be available in the next render
  }, [evaluate]);

  const handleRunCode = useCallback(async () => {
    setIsRunning(true);
    setRunResult(null);
    const result = await runCode(editorCode);
    setRunResult(result);
    setIsRunning(false);
  }, [editorCode]);

  // Check if we should call onComplete after evaluation
  // Use useEffect to avoid calling during render
  React.useEffect(() => {
    if (evaluationResult?.isCorrect && onComplete) {
      onComplete(evaluationResult);
    }
  }, [evaluationResult, onComplete]);

  const handleSaveSelfExplanation = useCallback(
    async (text: string) => {
      try {
        await focusStore.saveSelfExplanation(dateKey, 'challenge', challengeId, text);
        setHasPromptedSelfExplanation(true);
      } catch (error) {
        logger.error('Failed to save self-explanation', { error }, 'ChallengeSandbox');
      }
    },
    [challengeId, dateKey]
  );

  const handleSkipSelfExplanation = useCallback(() => {
    setHasPromptedSelfExplanation(true);
  }, []);
  
  const monacoTheme = getMonacoTheme(colorMode);

  return (
    <div
      className={styles.container}
      role="region"
      aria-label={`Challenge: ${challenge.title}`}
    >
      {/* Header */}
      <ChallengeHeader
        challenge={challenge}
        mode={mode}
        onSelectMode={setMode}
        isDescriptionCollapsed={isDescriptionCollapsed}
        onToggleDescription={() => setIsDescriptionCollapsed(!isDescriptionCollapsed)}
        isDebugMode={isDebugMode}
        onSolveChallenge={solveChallengeWithAI}
        isSolving={isSolving}
        isEvaluating={isEvaluating}
      />

      {/* Solution error message */}
      {solveError && (
        <div className={styles.solveErrorBanner}>
          <Banner
            title="Error"
            description={solveError}
            variant="critical"
            hideTitle
          />
        </div>
      )}

      {mode === 'guided' && (
        <div className={styles.guidedPanelWrapper}>
          <GuidedModePanel plan={guidedPlan} isLoading={isGuidedPlanLoading} onClose={() => setMode('free')} />
        </div>
      )}

      {/* Main content */}
      <div className={`${styles.content} ${isEditorFullscreen ? styles.editorFullscreen : ''}`}>
        {/* Editor panel */}
        <div className={styles.editorPanel}>
          {/* File Manager */}
          <FileManager
            files={workspace.files}
            activeFileId={workspace.activeFileId}
            onSelectFile={workspace.setActiveFile}
            onAddFile={(name) => workspace.addFile(name)}
            onDeleteFile={workspace.deleteFile}
            onRenameFile={workspace.renameFile}
            onExport={() => setIsExportDialogOpen(true)}
            disabled={isEvaluating}
            language={challenge.language}
          />

          <div className={styles.editorHeader}>
            <span className={styles.editorLabel} title={activeFileName}>
              {activeFileName}
              {workspace.hasUnsavedChanges && <span className={styles.unsavedIndicator}>*</span>}
            </span>
            <div className={styles.editorHeaderRight}>
              <span className={styles.languageBadge}>
                <CodeIcon size={12} />
                {activeFileLanguageDisplay}
              </span>
              {workspace.isSaving && (
                <span className={styles.savingIndicator}>Saving...</span>
              )}
              <IconButton
                icon={isEditorFullscreen ? ScreenNormalIcon : ScreenFullIcon}
                aria-label={isEditorFullscreen ? 'Exit fullscreen' : 'Fullscreen editor'}
                size="small"
                variant="invisible"
                onClick={() => setIsEditorFullscreen(!isEditorFullscreen)}
              />
            </div>
          </div>
          <div className={styles.editorBody}>
            {isEditorReady ? (
              <Editor
                height="100%"
                path={activeFileName}
                language={getMonacoLanguageFromExtension(activeFileName.split('.').pop() ?? 'ts')}
                value={activeFile?.content ?? ''}
                onChange={(value) => {
                  if (workspace.activeFileId) {
                    workspace.updateFileContent(workspace.activeFileId, value ?? '');
                  }
                }}
                onMount={handleEditorMount}
                beforeMount={handleBeforeMount}
                theme={monacoTheme}
                options={getMonacoEditorOptions()}
                aria-label={`Code editor for ${activeFileName}`}
              />
            ) : (
              <div className={styles.editorLoadingPlaceholder}>
                Loading editor...
              </div>
            )}
          </div>
          <CodeOutputPanel result={runResult} isRunning={isRunning} language={challenge.language} />
        </div>

        <ResultsPanel
          challenge={challenge}
          challengeId={challengeId}
          dateKey={dateKey}
          evaluation={evaluation}
          evaluationResult={evaluationResult}
          isEvaluating={isEvaluating}
          isEvaluationCollapsed={isEvaluationCollapsed}
          onToggleEvaluationCollapsed={() => setIsEvaluationCollapsed(!isEvaluationCollapsed)}
          onOpenResetDialog={() => setIsResetDialogOpen(true)}
          onStopEvaluation={stopEvaluation}
          onRunCode={handleRunCode}
          onEvaluate={handleEvaluate}
          isRunning={isRunning}
          canRunInBrowser={canRunInBrowser}
          canEvaluate={workspace.files.some((f) => f.content.trim().length > 0)}
          isRateLimited={isRateLimited}
          rateLimitRetryInSeconds={rateLimitRetryInSeconds}
          showSelfExplanationCard={showSelfExplanationCard}
          onSaveSelfExplanation={handleSaveSelfExplanation}
          onSkipSelfExplanation={handleSkipSelfExplanation}
          hints={hints}
          isLoadingHint={isLoadingHint}
          hintError={hintError}
          onRequestHint={requestHint}
          onStopHint={stopHint}
          isHintsCollapsed={isHintsCollapsed}
          onToggleHintsCollapsed={() => setIsHintsCollapsed(!isHintsCollapsed)}
        />
      </div>

      {/* Reset confirmation dialog */}
      {isResetDialogOpen && (
        <ConfirmationDialog
          title="Reset code?"
          onClose={handleResetDialogClose}
          confirmButtonContent="Reset"
          confirmButtonType="danger"
          cancelButtonContent="Cancel"
        >
          This will clear your code and all evaluation results. This cannot be undone.
        </ConfirmationDialog>
      )}

      {/* Export to GitHub dialog */}
      <ExportToGitHubDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        files={workspace.files}
        challenge={challenge}
        challengeId={challengeId}
        evaluationSummary={evaluationResult?.feedback}
        hints={hints.map((h) => h.response.hint)}
      />
    </div>
  );
}
