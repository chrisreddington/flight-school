'use client';

import { CheckIcon, CopilotIcon, PencilIcon, XIcon } from '@primer/octicons-react';
import { Heading, IconButton, Stack, TextInput, Tooltip } from '@primer/react';
import type { Thread } from '@/lib/threads/types';
import styles from './LearningChat.module.css';
import type { ThreadTitleEditing } from './useThreadTitleEditing';

interface ChatHeaderProps {
  /** Currently active thread, or null when no thread is selected. */
  activeThread: Thread | null;
  /** Title editing state + handlers produced by {@link useThreadTitleEditing}. */
  titleEditing: ThreadTitleEditing;
}

/**
 * Renders the chat area header: the Copilot icon plus either the
 * thread title with a rename affordance, or the inline edit input
 * with save/cancel controls.
 */
export function ChatHeader({ activeThread, titleEditing }: ChatHeaderProps) {
  const { isEditing, editingTitle, inputRef, setEditingTitle, startEdit, save, cancel, handleKeyDown } = titleEditing;

  return (
    <div className={styles.header}>
      <Stack direction="horizontal" align="center" gap="condensed" className={styles.headerContent}>
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
