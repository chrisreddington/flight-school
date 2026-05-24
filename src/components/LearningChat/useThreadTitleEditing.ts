import { useCallback, useRef, useState } from 'react';
import type { Thread } from '@/lib/threads/types';

/**
 * State and handlers for inline editing of the active thread's title.
 *
 * Exposes a ref to attach to the text input so the hook can focus it
 * once the user enters edit mode (a one-tick `setTimeout` is required
 * because the input only mounts after `isEditing` flips to true).
 */
export interface ThreadTitleEditing {
  isEditing: boolean;
  editingTitle: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setEditingTitle: (value: string) => void;
  startEdit: () => void;
  save: () => void;
  cancel: () => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Encapsulate the inline thread-title editing UX.
 *
 * The hook owns the transient input state (edit mode + draft value) and
 * delegates persistence to the supplied `onRename` callback so the chat
 * component does not have to thread title state through its render body.
 */
export function useThreadTitleEditing(
  activeThread: Thread | null,
  activeThreadId: string | null,
  onRename: (threadId: string, title: string) => void,
): ThreadTitleEditing {
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    if (!activeThread) return;
    setEditingTitle(activeThread.title);
    setIsEditing(true);
    // Focus after the input mounts on the next tick.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [activeThread]);

  const save = useCallback(() => {
    if (activeThreadId && editingTitle.trim()) {
      onRename(activeThreadId, editingTitle.trim());
    }
    setIsEditing(false);
    setEditingTitle('');
  }, [activeThreadId, editingTitle, onRename]);

  const cancel = useCallback(() => {
    setIsEditing(false);
    setEditingTitle('');
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        cancel();
      }
    },
    [save, cancel],
  );

  return {
    isEditing,
    editingTitle,
    inputRef,
    setEditingTitle,
    startEdit,
    save,
    cancel,
    handleKeyDown,
  };
}
