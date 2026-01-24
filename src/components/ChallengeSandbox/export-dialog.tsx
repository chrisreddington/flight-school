/**
 * ExportToGitHubDialog Component
 *
 * A dialog for exporting challenge workspace files to a GitHub repository.
 * Creates a new repository with all workspace files, README, and optional HINTS.
 *
 * @remarks
 * This component follows the same pattern as CreateRepoDialog.
 * It manages all dialog state internally and calls the export API.
 *
 * @example
 * ```tsx
 * <ExportToGitHubDialog
 *   isOpen={showExport}
 *   onClose={() => setShowExport(false)}
 *   returnFocusRef={buttonRef}
 *   workspace={workspace}
 *   challenge={challenge}
 *   evaluationSummary={lastEvaluation?.feedback}
 *   hints={usedHints}
 * />
 * ```
 */

'use client';

import { apiPost } from '@/lib/api-client';
import {
    FileCodeIcon,
    LockIcon,
    RepoIcon,
    UnlockIcon,
} from '@primer/octicons-react';
import {
    Banner,
    Button,
    FormControl,
    Link,
    Spinner,
    Stack,
    TextInput,
    ToggleSwitch,
} from '@primer/react';
import { Dialog } from '@primer/react/experimental';
import { useCallback, useState } from 'react';

import type { ChallengeDef } from '@/lib/copilot/types';
import type { WorkspaceFile } from '@/lib/workspace';
import styles from './ExportDialog.module.css';

// =============================================================================
// Types
// =============================================================================

/** Response from workspace export API */
interface ExportResponse {
  success: boolean;
  repoUrl?: string;
  repoName?: string;
  error?: string;
}

/** Export error with retry context */
interface ExportError {
  message: string;
  canRetry: boolean;
}

/** Props for the ExportToGitHubDialog component */
export interface ExportToGitHubDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback to close the dialog */
  onClose: () => void;
  /** Optional ref to return focus to when dialog closes */
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
  /** Workspace files to export */
  files: WorkspaceFile[];
  /** Challenge definition for context */
  challenge: ChallengeDef;
  /** Challenge ID for export metadata */
  challengeId: string;
  /** Optional evaluation summary to include in README */
  evaluationSummary?: string;
  /** Optional hints used during the challenge */
  hints?: string[];
}

// =============================================================================
// Component
// =============================================================================

/**
 * Dialog for exporting workspace to a GitHub repository.
 *
 * Features:
 * - Pre-fills repo name from challenge
 * - Shows file list preview
 * - Private/public toggle
 * - Generates README with challenge context
 * - Optionally includes HINTS.md
 */
export function ExportToGitHubDialog({
  isOpen,
  onClose,
  returnFocusRef,
  files,
  challenge,
  challengeId,
  evaluationSummary,
  hints,
}: ExportToGitHubDialogProps) {
  // Form state
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false); // Default to public
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<ExportError | null>(null);
  const [exportedRepo, setExportedRepo] = useState<{ name: string; url: string } | null>(null);
  const [exportProgress, setExportProgress] = useState<string>('');
  const [progressTimer, setProgressTimer] = useState<NodeJS.Timeout | null>(null);

  /**
   * Pre-fills form with challenge-based defaults when dialog opens.
   */
  const initializeForm = useCallback(() => {
    const slug = challenge.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const suggestedName = `challenge-${slug}`;
    setRepoName(suggestedName);
    setDescription(`Solution: ${challenge.title}`);
    setExportError(null);
    setExportedRepo(null);
    setExportProgress('');
  }, [challenge]);

  /** Resets the dialog state on close */
  const handleClose = useCallback(() => {
    if (progressTimer) {
      clearInterval(progressTimer);
      setProgressTimer(null);
    }
    setRepoName('');
    setDescription('');
    setIsPrivate(false);
    setExportError(null);
    setExportedRepo(null);
    setIsExporting(false);
    setExportProgress('');
    onClose();
  }, [onClose, progressTimer]);

  /** Determines if an error is retryable */
  const isRetryableError = useCallback((errorMessage: string): boolean => {
    const nonRetryable = [
      'already exists and has content',
      'choose a different name',
      'authentication',
      'not configured',
    ];
    const lowerMessage = errorMessage.toLowerCase();
    return !nonRetryable.some((phrase) => lowerMessage.includes(phrase));
  }, []);

  /** Exports the workspace via API call */
  const handleExport = useCallback(async () => {
    if (!repoName.trim()) {
      setExportError({ message: 'Repository name is required', canRetry: false });
      return;
    }

    setIsExporting(true);
    setExportError(null);
    
    // Start progress message rotation
    const progressMessages = [
      'Creating repository...',
      'Waiting for GitHub to initialize...',
      'Preparing files...',
      'Creating file blobs...',
      'Building commit tree...',
      'Creating initial commit...',
      'Finalizing...',
    ];
    let messageIndex = 0;
    setExportProgress(progressMessages[0]);
    
    const timer = setInterval(() => {
      messageIndex = (messageIndex + 1) % progressMessages.length;
      setExportProgress(progressMessages[messageIndex]);
    }, 2000); // Rotate every 2 seconds
    
    setProgressTimer(timer);

    try {
      const data = await apiPost<ExportResponse>('/api/repos/create-from-workspace', {
        challengeId,
        repoName: repoName.trim(),
        description: description.trim() || undefined,
        isPrivate,
        files: files.map((f) => ({ name: f.name, content: f.content })),
        challenge,
        evaluation: evaluationSummary,
        hints,
      });

      if (!data.success) {
        const errorMessage = data.error || 'Failed to export workspace';
        throw new Error(errorMessage);
      }

      setExportedRepo({
        name: data.repoName!,
        url: data.repoUrl!,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export workspace';
      setExportError({
        message,
        canRetry: isRetryableError(message),
      });
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
        setProgressTimer(null);
      }
      setIsExporting(false);
      setExportProgress('');
    }
  }, [repoName, description, isPrivate, files, challenge, challengeId, evaluationSummary, hints, isRetryableError, progressTimer]);

  // Initialize form when dialog opens
  if (isOpen && !repoName && !exportedRepo) {
    initializeForm();
  }

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog
      title="Export to GitHub"
      onClose={handleClose}
      returnFocusRef={returnFocusRef}
      width="medium"
    >
      <div className={styles.dialogContent}>
        {exportedRepo ? (
          /* Success state */
          <Stack direction="vertical" gap="normal">
            <Banner variant="success" title="Success" hideTitle>
              Repository created successfully!
            </Banner>
            <Stack direction="horizontal" align="center" gap="condensed">
              <RepoIcon size={16} />
              <Link href={exportedRepo.url} target="_blank" rel="noopener noreferrer">
                {exportedRepo.name}
              </Link>
            </Stack>
            <p className={styles.hint}>
              Your workspace has been exported with a README documenting the challenge
              {hints && hints.length > 0 ? ' and a HINTS.md file' : ''}.
            </p>
            <Stack direction="horizontal" gap="condensed" justify="end">
              <Button onClick={handleClose}>Close</Button>
              <Button
                as="a"
                href={exportedRepo.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="primary"
              >
                Open Repository
              </Button>
            </Stack>
          </Stack>
        ) : (
          /* Form state */
          <Stack direction="vertical" gap="normal">
            {exportError && (
              <Banner title="Error" hideTitle variant="critical">
                <Stack direction="vertical" gap="condensed">
                  <span>{exportError.message}</span>
                  {exportError.canRetry && (
                    <p className={styles.hint}>
                      This may be a temporary issue. You can try again.
                    </p>
                  )}
                </Stack>
              </Banner>
            )}

            {isExporting ? (
              /* Loading state */
              <Stack direction="vertical" gap="normal" align="center" style={{ padding: '24px 0' }}>
                <Spinner size="large" />
                <Stack direction="vertical" gap="condensed" align="center">
                  <p className={styles.loadingTitle}>Exporting your workspace...</p>
                  <p className={styles.loadingHint}>
                    {exportProgress || `Creating repository and committing ${files.length} file${files.length !== 1 ? 's' : ''}.`}
                  </p>
                </Stack>
              </Stack>
            ) : (
              /* Form inputs */
              <>
                <FormControl>
                  <FormControl.Label>Repository Name</FormControl.Label>
                  <TextInput
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="challenge-reverse-string"
                    block
                    aria-describedby="repo-name-hint"
                  />
                  <FormControl.Caption id="repo-name-hint">
                    Use lowercase letters, numbers, and hyphens
                  </FormControl.Caption>
                </FormControl>

                <FormControl>
                  <FormControl.Label>Description (optional)</FormControl.Label>
                  <TextInput
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="My solution to the challenge..."
                    block
                  />
                </FormControl>

                <Stack gap="condensed">
                  <Stack direction="horizontal" align="center" gap="normal" justify="space-between">
                    <Stack direction="horizontal" align="center" gap="condensed">
                      {isPrivate ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
                      <span style={{ fontWeight: 600 }} id="repo-visibility-label">Repository</span>
                    </Stack>
                    <ToggleSwitch
                      checked={isPrivate}
                      onClick={() => setIsPrivate(!isPrivate)}
                      onChange={setIsPrivate}
                      aria-labelledby="repo-visibility-label"
                      buttonLabelOn="Private"
                      buttonLabelOff="Public"
                    />
                  </Stack>
                  <p style={{ fontSize: '12px', color: 'var(--fgColor-muted)', margin: 0 }}>
                    {isPrivate
                      ? 'Only you can see this repository'
                      : 'Anyone can see this repository'}
                  </p>
                </Stack>

                <div className={styles.filePreview}>
                  <p className={styles.filePreviewTitle}>
                    <FileCodeIcon size={14} /> Files to export ({files.length})
                  </p>
                  <ul className={styles.fileList}>
                    {files.map((file) => (
                      <li key={file.id}>{file.name}</li>
                    ))}
                    <li className={styles.generatedFile}>README.md (generated)</li>
                    {hints && hints.length > 0 && (
                      <li className={styles.generatedFile}>HINTS.md (generated)</li>
                    )}
                  </ul>
                </div>

                <Stack direction="horizontal" gap="condensed" justify="end">
                  <Button onClick={handleClose}>Cancel</Button>
                  <Button
                    variant="primary"
                    onClick={handleExport}
                    disabled={!repoName.trim()}
                    leadingVisual={RepoIcon}
                  >
                    Export to GitHub
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        )}
      </div>
    </Dialog>
  );
}
