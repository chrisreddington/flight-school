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
import { getLanguageDisplayName, getMonacoLanguageFromExtension } from '@/lib/editor/monaco-language-map';
import type { OnMount } from '@monaco-editor/react';
import {
    BeakerIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CodeIcon,
    LightBulbIcon,
    PlayIcon,
    RocketIcon,
    ScreenFullIcon,
    ScreenNormalIcon,
    SkipIcon,
} from '@primer/octicons-react';
import { Banner, Button, ConfirmationDialog, IconButton, useTheme } from '@primer/react';
import dynamic from 'next/dynamic';
import React, { useCallback, useEffect, useState } from 'react';

// Lazy load Monaco Editor (2MB+) to avoid blocking initial page load
// PERF: Use loading placeholder with exact dimensions to avoid layout shift
// PERF: Set ssr: false to prevent hydration issues and reduce server bundle
const Editor = dynamic(() => import('@monaco-editor/react'), {
  loading: () => (
    <div 
      style={{ 
        padding: '16px', 
        textAlign: 'center',
        height: '100%',
        minHeight: '300px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bgColor-muted, #f6f8fa)',
        color: 'var(--fgColor-muted, #656d76)',
        fontSize: '14px',
      }}
    >
      Loading editor...
    </div>
  ),
  ssr: false,
});

import { useDebugMode } from '@/contexts/debug-context';
import { DifficultyBadge } from '@/components/DifficultyBadge';
import { MarkdownContent } from '@/components/MarkdownContent';
import styles from './ChallengeSandbox.module.css';
import { EvaluationResultDisplay } from './evaluation-result-display';
import { ExportToGitHubDialog } from './export-dialog';
import { FileManager } from './file-manager';
import { HintDisplay } from './hint-display';
import type { ChallengeSandboxProps } from './types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Monaco editor key modifier for Ctrl (Windows/Linux) or Cmd (macOS).
 * Used for cross-platform keyboard shortcuts.
 * @see https://microsoft.github.io/monaco-editor/api/enums/monaco.KeyMod.html
 */
const MONACO_KEYMOD_CTRL_CMD = 2048;

/**
 * Monaco editor key code for Enter key.
 * @see https://microsoft.github.io/monaco-editor/api/enums/monaco.KeyCode.html
 */
const MONACO_KEYCODE_ENTER = 3;

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
  const [isDescriptionCollapsed, setIsDescriptionCollapsed] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  
  // PERF: Defer Monaco editor mount until after initial paint to prevent
  // forced reflow during page load. Monaco's measureReferenceDomElement
  // triggers synchronous layout that blocks render if mounted immediately.
  const [isEditorReady, setIsEditorReady] = useState(false);
  useEffect(() => {
    // Use requestIdleCallback if available, otherwise requestAnimationFrame + setTimeout
    // This ensures editor mounts after browser has completed initial paint
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => setIsEditorReady(true), { timeout: 100 });
      return () => cancelIdleCallback(id);
    } else {
      const rafId = requestAnimationFrame(() => {
        const timeoutId = setTimeout(() => setIsEditorReady(true), 16);
        return () => clearTimeout(timeoutId);
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, []);
  
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

  // Get active file for language detection
  const activeFile = workspace.files.find((f) => f.id === workspace.activeFileId);
  const activeFileName = activeFile?.name ?? 'solution.ts';
  const activeFileExtension = activeFileName.split('.').pop() ?? '';
  const activeFileLanguage = getMonacoLanguageFromExtension(activeFileExtension);
  const activeFileLanguageDisplay = getLanguageDisplayName(activeFileLanguage);

  // Handle reset confirmation dialog
  const handleResetDialogClose = useCallback((gesture: 'confirm' | 'close-button' | 'cancel' | 'escape') => {
    setIsResetDialogOpen(false);
    if (gesture === 'confirm') {
      reset();
    }
  }, [reset]);

  // Handle Monaco editor mount for keyboard shortcuts
  const handleEditorMount = useCallback<OnMount>(
    (editor) => {
      // Add Cmd/Ctrl+Enter keybinding to run evaluation
      editor.addCommand(
        MONACO_KEYMOD_CTRL_CMD | MONACO_KEYCODE_ENTER,
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

  // Check if we should call onComplete after evaluation
  // Use useEffect to avoid calling during render
  React.useEffect(() => {
    if (evaluationResult?.isCorrect && onComplete) {
      onComplete(evaluationResult);
    }
  }, [evaluationResult, onComplete]);
  
  // Determine Monaco theme based on color mode
  const monacoTheme = colorMode === 'night' ? 'vs-dark' : 'light';

  return (
    <div
      className={styles.container}
      role="region"
      aria-label={`Challenge: ${challenge.title}`}
    >
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>
            <CodeIcon size={20} />
          </span>
          <div className={styles.headerTitleGroup}>
            <div className={styles.headerTitleRow}>
              <h2 className={styles.headerTitle}>{challenge.title}</h2>
              {challenge.description && (
                <IconButton
                  icon={isDescriptionCollapsed ? ChevronRightIcon : ChevronDownIcon}
                  aria-label={isDescriptionCollapsed ? 'Expand description' : 'Collapse description'}
                  aria-expanded={!isDescriptionCollapsed}
                  size="small"
                  variant="invisible"
                  onClick={() => setIsDescriptionCollapsed(!isDescriptionCollapsed)}
                />
              )}
            </div>
            {challenge.description && !isDescriptionCollapsed && (
              <div className={styles.headerDescription}>
                <MarkdownContent content={challenge.description} />
              </div>
            )}
          </div>
          <DifficultyBadge difficulty={challenge.difficulty} variant="css" />
        </div>
        <div className={styles.headerRight}>
          {isDebugMode && (
            <Button
              variant="invisible"
              size="small"
              onClick={solveChallengeWithAI}
              leadingVisual={RocketIcon}
              disabled={isSolving || isEvaluating}
            >
              {isSolving ? 'Solving...' : 'Solve Challenge'}
            </Button>
          )}
        </div>
      </div>

      {/* Solution error message */}
      {solveError && (
        <Banner
          title="Error"
          description={solveError}
          variant="critical"
          hideTitle
          style={{ marginBottom: 16 }}
        />
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
                language={getMonacoLanguageFromExtension(activeFileName.split('.').pop() ?? 'ts')}
                value={activeFile?.content ?? ''}
                onChange={(value) => {
                  if (workspace.activeFileId) {
                    workspace.updateFileContent(workspace.activeFileId, value ?? '');
                  }
                }}
                onMount={handleEditorMount}
                theme={monacoTheme}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'on',
                  padding: { top: 12, bottom: 12 },
                  renderLineHighlight: 'line',
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
                aria-label={`Code editor for ${activeFileName}`}
              />
            ) : (
              <div 
                style={{ 
                  padding: '16px', 
                  textAlign: 'center',
                  height: '100%',
                  minHeight: '300px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--bgColor-muted, #f6f8fa)',
                  color: 'var(--fgColor-muted, #656d76)',
                  fontSize: '14px',
                }}
              >
                Loading editor...
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className={styles.rightPanel}>
          {/* Evaluation section */}
          <div className={`${styles.evaluationSection} ${isEvaluationCollapsed ? styles.collapsed : ''} ${isHintsCollapsed && !isEvaluationCollapsed ? styles.expanded : ''}`}>
            <div className={styles.sectionHeader}>
              <button
                className={styles.sectionHeaderToggle}
                onClick={() => setIsEvaluationCollapsed(!isEvaluationCollapsed)}
                aria-expanded={!isEvaluationCollapsed}
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
                  onClick={() => setIsResetDialogOpen(true)}
                  leadingVisual={SkipIcon}
                  disabled={isEvaluating}
                >
                  Reset
                </Button>
                {isEvaluating ? (
                  <Button variant="danger" size="small" onClick={stopEvaluation}>
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="small"
                    onClick={handleEvaluate}
                    leadingVisual={PlayIcon}
                    disabled={!workspace.files.some(f => f.content.trim())}
                  >
                    Evaluate
                  </Button>
                )}
              </div>
            </div>
            {!isEvaluationCollapsed && (
              <EvaluationResultDisplay evaluation={evaluation} />
            )}
          </div>

          {/* Hints section */}
          <div className={`${styles.hintSection} ${isHintsCollapsed ? styles.collapsed : ''}`}>
            <div className={styles.sectionHeader}>
              <button
                className={styles.sectionHeaderToggle}
                onClick={() => setIsHintsCollapsed(!isHintsCollapsed)}
                aria-expanded={!isHintsCollapsed}
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
                onRequestHint={requestHint}
                onStopHint={stopHint}
              />
            )}
          </div>
        </div>
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
