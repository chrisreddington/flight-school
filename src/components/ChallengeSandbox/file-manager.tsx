/**
 * FileManager Component
 *
 * Tab-based file navigation for the Challenge Sandbox.
 * Provides file switching, adding, renaming, and deletion.
 *
 * @remarks
 * Follows WCAG accessibility guidelines with keyboard navigation
 * and proper ARIA labels.
 */

'use client';

import {
    BeakerIcon,
    FileCodeIcon,
    FileIcon,
    GearIcon,
    PlusIcon,
    RepoIcon,
    ToolsIcon,
    WorkflowIcon,
    XIcon,
} from '@primer/octicons-react';
import { ActionList, ActionMenu, Button, IconButton, TextInput, Tooltip } from '@primer/react';
import React, { useCallback, useRef, useState } from 'react';

import type { WorkspaceFile } from '@/lib/workspace';
import type { FileTemplate } from '@/lib/workspace/file-templates';
import { getFilePathFromTemplate, getFileTemplatesForLanguage } from '@/lib/workspace/file-templates';
import styles from './FileManager.module.css';

// =============================================================================
// Types
// =============================================================================

/** Props for the FileManager component */
export interface FileManagerProps {
  /** Files in the workspace */
  files: WorkspaceFile[];
  /** ID of the currently active file */
  activeFileId: string;
  /** Called when user selects a file */
  onSelectFile: (fileId: string) => void;
  /** Called when user adds a new file */
  onAddFile: (name?: string) => void;
  /** Called when user deletes a file */
  onDeleteFile: (fileId: string) => void;
  /** Called when user renames a file */
  onRenameFile: (fileId: string, newName: string) => void;
  /** Called when user clicks export to GitHub */
  onExport?: () => void;
  /** Whether file operations are disabled */
  disabled?: boolean;
  /** Challenge language for language-specific templates */
  language: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Maps template icon identifier to Octicon component */
function getTemplateIcon(iconId: FileTemplate['icon']): React.ReactNode {
  switch (iconId) {
    case 'file-code':
      return <FileCodeIcon />;
    case 'beaker':
      return <BeakerIcon />;
    case 'tools':
      return <ToolsIcon />;
    case 'gear':
      return <GearIcon />;
    case 'workflow':
      return <WorkflowIcon />;
    default:
      return <FileIcon />;
  }
}

/** Gets an appropriate icon for a file based on its name. */
function getFileIcon(filename: string): React.ReactNode {
  const lower = filename.toLowerCase();
  
  if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('_test.')) {
    return <BeakerIcon size={14} />;
  }
  
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.rb'];
  if (codeExtensions.some((ext) => lower.endsWith(ext))) {
    return <FileCodeIcon size={14} />;
  }
  
  return <FileIcon size={14} />;
}

// =============================================================================
// FileTab Component
// =============================================================================

interface FileTabProps {
  file: WorkspaceFile;
  isActive: boolean;
  isOnly: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (newName: string) => void;
  onNavigate: (direction: 'left' | 'right') => void;
  disabled?: boolean;
}

function FileTab({
  file,
  isActive,
  isOnly,
  onSelect,
  onClose,
  onRename,
  onNavigate,
  disabled,
}: FileTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback(() => {
    if (disabled) return;
    setEditValue(file.name);
    setIsEditing(true);
    // Focus input after render
    setTimeout(() => inputRef.current?.select(), 0);
  }, [disabled, file.name]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== file.name) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editValue, file.name, onRename]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setEditValue(file.name);
      setIsEditing(false);
    }
  }, [handleRenameSubmit, file.name]);

  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  if (isEditing) {
    return (
      <div className={`${styles.tab} ${styles.tabEditing}`}>
        <TextInput
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={handleKeyDown}
          size="small"
          aria-label="Rename file"
          className={styles.renameInput}
        />
      </div>
    );
  }

  return (
    <div
      role="tab"
      tabIndex={isActive ? 0 : -1}
      aria-selected={isActive}
      className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onNavigate('left');
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onNavigate('right');
        }
      }}
    >
      <span className={styles.tabIcon}>{getFileIcon(file.name)}</span>
      <span className={styles.tabName} title={file.name}>
        {/* Show only filename, not full path */}
        {file.name.split('/').pop()}
      </span>
      {!isOnly && !disabled && (
        <Tooltip text="Close file">
          <IconButton
            icon={XIcon}
            aria-label={`Close ${file.name}`}
            variant="invisible"
            size="small"
            onClick={handleCloseClick}
            className={styles.tabClose}
          />
        </Tooltip>
      )}
    </div>
  );
}

// =============================================================================
// FileManager Component
// =============================================================================

/**
 * Tab-based file manager for workspace navigation.
 *
 * Features:
 * - File tabs with icons
 * - Add new file
 * - Delete file (with protection for last file)
 * - Rename file (double-click)
 * - Keyboard navigation
 */
export function FileManager({
  files,
  activeFileId,
  onSelectFile,
  onAddFile,
  onDeleteFile,
  onRenameFile,
  onExport,
  disabled = false,
  language,
}: FileManagerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tabListRef = useRef<HTMLDivElement>(null);
  
  // Get language-specific file templates
  const fileTemplates = getFileTemplatesForLanguage(language);

  // Keyboard navigation between tabs
  const handleNavigate = useCallback((direction: 'left' | 'right') => {
    const currentIndex = files.findIndex((f) => f.id === activeFileId);
    const delta = direction === 'left' ? -1 : 1;
    const newIndex = (currentIndex + delta + files.length) % files.length;
    onSelectFile(files[newIndex].id);
  }, [files, activeFileId, onSelectFile]);

  const handleAddFile = useCallback((template: FileTemplate) => {
    const fullPath = getFilePathFromTemplate(template);
    onAddFile(fullPath);
    setMenuOpen(false);
  }, [onAddFile]);

  return (
    <div className={styles.container} role="tablist" aria-label="Workspace files">
      <div 
        ref={tabListRef}
        className={styles.tabs}
      >
        {files.map((file) => (
          <FileTab
            key={file.id}
            file={file}
            isActive={file.id === activeFileId}
            isOnly={files.length === 1}
            onSelect={() => onSelectFile(file.id)}
            onClose={() => onDeleteFile(file.id)}
            onRename={(newName) => onRenameFile(file.id, newName)}
            onNavigate={handleNavigate}
            disabled={disabled}
          />
        ))}
      </div>
      
      <div className={styles.actions}>
        <ActionMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <ActionMenu.Anchor>
            <IconButton
              icon={PlusIcon}
              aria-label="Add new file"
              variant="invisible"
              size="small"
              disabled={disabled}
            />
          </ActionMenu.Anchor>
          <ActionMenu.Overlay>
            <ActionList>
              {fileTemplates.map((template, index) => (
                <ActionList.Item 
                  key={index} 
                  onSelect={() => handleAddFile(template)}
                >
                  <ActionList.LeadingVisual>
                    {getTemplateIcon(template.icon)}
                  </ActionList.LeadingVisual>
                  {template.label}
                  {template.subdirectory && (
                    <ActionList.Description>
                      {template.subdirectory}/
                    </ActionList.Description>
                  )}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        {onExport && (
          <Button
            size="small"
            onClick={onExport}
            leadingVisual={RepoIcon}
            className={styles.exportButton}
          >
            Export to GitHub
          </Button>
        )}
      </div>
    </div>
  );
}
