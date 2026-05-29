'use client';

import { CheckIcon, CopilotIcon, PencilIcon, ThreeBarsIcon, XIcon } from '@primer/octicons-react';
import { Heading, IconButton, Stack, TextInput, Tooltip } from '@primer/react';
import type { Thread } from '@/lib/threads/types';
import styles from './LearningChat.module.css';
import type { ThreadTitleEditing } from './useThreadTitleEditing';

interface ChatHeaderProps {
  /** Currently active thread, or null when no thread is selected. */
  activeThread: Thread | null;
  /** Title editing state + handlers produced by {@link useThreadTitleEditing}. */
  titleEditing: ThreadTitleEditing;
  /**
   * Opens the conversations drawer. Only supplied on phone-width layouts,
   * where the inline thread sidebar is hidden; the trigger itself is also
   * hidden via CSS above the phone breakpoint.
   */
  onOpenThreads?: () => void;
  /** Whether the conversations drawer is currently open (for `aria-expanded`). */
  isThreadsOpen?: boolean;
}

/**
 * Renders the chat area header: an optional conversations-drawer trigger
 * (phone only), the Copilot icon, plus either the thread title with a
 * rename affordance, or the inline edit input with save/cancel controls.
 */
export function ChatHeader({ activeThread, titleEditing, onOpenThreads, isThreadsOpen = false }: ChatHeaderProps) {
  const { isEditing, editingTitle, inputRef, setEditingTitle, startEdit, save, cancel, handleKeyDown } = titleEditing;

  return (
    <div className={styles.header}>
      <Stack direction="horizontal" align="center" gap="condensed" className={styles.headerContent}>
        {onOpenThreads && (
          <span className={styles.threadsTrigger}>
            <Tooltip text="Conversations" direction="se">
              <IconButton
                icon={ThreeBarsIcon}
                aria-label="Open conversations"
                aria-haspopup="dialog"
                aria-expanded={isThreadsOpen}
                variant="invisible"
                onClick={onOpenThreads}
              />
            </Tooltip>
          </span>
        )}
        <span className={styles.headerIcon}>
          <CopilotIcon size={20} />
        </span>
        {isEditing ? (
          <Stack direction="horizontal" align="center" gap="condensed" className={styles.titleEditContainer}>
            <TextInput
              ref={inputRef}
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={save}
              size="small"
              aria-label="Edit thread title"
              className={styles.titleInput}
            />
            <Tooltip text="Save" direction="s">
              <IconButton icon={CheckIcon} aria-label="Save title" variant="invisible" size="small" onClick={save} />
            </Tooltip>
            <Tooltip text="Cancel" direction="s">
              <IconButton icon={XIcon} aria-label="Cancel edit" variant="invisible" size="small" onClick={cancel} />
            </Tooltip>
          </Stack>
        ) : (
          <Stack direction="horizontal" align="center" gap="condensed">
            <Heading as="h2" className={styles.headerTitle}>
              {activeThread?.title || 'Learning Chat'}
            </Heading>
            {activeThread && (
              <Tooltip text="Rename thread" direction="s">
                <IconButton
                  icon={PencilIcon}
                  aria-label="Rename thread"
                  variant="invisible"
                  size="small"
                  onClick={startEdit}
                  className={styles.editButton}
                />
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>
    </div>
  );
}
