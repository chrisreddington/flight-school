/**
 * RepoSelector Component
 *
 * Repository selector with combobox pattern and token display.
 * Implements ARIA combobox for searching and selecting repositories,
 * with selected repos displayed as removable tokens/tags.
 *
 * @example
 * ```tsx
 * <RepoSelector
 *   selectedRepos={thread.context.repos}
 *   onSelectionChange={(repos) => updateContext(threadId, \{ repos \})}
 *   availableRepos={userRepos}
 *   placeholder="Add repositories for context..."
 * />
 * ```
 */

'use client';

import type { RepoReference } from '@/lib/threads/types';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, RepoIcon, SearchIcon } from '@primer/octicons-react';
import { Spinner, TextInput, Token } from '@primer/react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './RepoSelector.module.css';
import type { RepoOption, RepoSelectorProps } from './types';

export function RepoSelector({
  selectedRepos,
  onSelectionChange,
  availableRepos = [],
  isLoading = false,
  placeholder = 'Search repositories...',
  maxSelections = 5,
  disabled = false,
  compact = false,
  inline = false,
}: RepoSelectorProps) {
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // PERF: Memoize expensive filtering to prevent recalculation on every render
  // Filter available repos based on search, excluding already selected
  const filteredOptions = useMemo(() => {
    const selectedFullNames = new Set(selectedRepos.map((r) => r.fullName));
    return availableRepos
      .filter((repo) => !selectedFullNames.has(repo.fullName))
      .filter((repo) =>
        repo.fullName.toLowerCase().includes(searchValue.toLowerCase())
      )
      .slice(0, 10); // Limit dropdown options
  }, [availableRepos, selectedRepos, searchValue]);

  // Handle clicking outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        if (inline) setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inline]);

  // Ensure highlighted index is valid when options change
  const safeHighlightedIndex = highlightedIndex >= filteredOptions.length ? -1 : highlightedIndex;

  const handleSelectRepo = useCallback(
    (repo: RepoOption) => {
      if (selectedRepos.length >= maxSelections) return;

      const newRepo: RepoReference = {
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
      };

      onSelectionChange([...selectedRepos, newRepo]);
      setSearchValue('');
      setIsOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.focus();
    },
    [selectedRepos, maxSelections, onSelectionChange]
  );

  const handleRemoveRepo = useCallback(
    (fullName: string) => {
      onSelectionChange(selectedRepos.filter((r) => r.fullName !== fullName));
      inputRef.current?.focus();
    },
    [selectedRepos, onSelectionChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen && e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
        return;
      }

      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
            handleSelectRepo(filteredOptions[highlightedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
        case 'Backspace':
          if (searchValue === '' && selectedRepos.length > 0) {
            // Remove last selected repo
            handleRemoveRepo(selectedRepos[selectedRepos.length - 1].fullName);
          }
          break;
      }
    },
    [
      isOpen,
      filteredOptions,
      highlightedIndex,
      handleSelectRepo,
      searchValue,
      selectedRepos,
      handleRemoveRepo,
    ]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchValue(e.target.value);
      if (!isOpen) setIsOpen(true);
    },
    [isOpen]
  );

  const handleInputFocus = useCallback(() => {
    if (filteredOptions.length > 0 || searchValue) {
      setIsOpen(true);
    }
  }, [filteredOptions.length, searchValue]);

  const listboxId = 'repo-selector-listbox';
  const canAddMore = selectedRepos.length < maxSelections;

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Inline mode: compact trigger with expandable panel
  if (inline) {
    return (
      <div ref={containerRef} className={styles.inlineContainer}>
        {/* Trigger button */}
        <button
          type="button"
          className={styles.inlineTrigger}
          onClick={handleToggleExpanded}
          disabled={disabled}
          aria-expanded={isExpanded}
          aria-label={`Context: ${selectedRepos.length} repositories selected`}
        >
          <RepoIcon size={14} className={styles.inlineTriggerIcon} />
          {selectedRepos.length > 0 && (
            <span className={styles.inlineBadge}>{selectedRepos.length}</span>
          )}
          {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>

        {/* Expanded panel */}
        {isExpanded && (
          <div className={styles.inlinePanel}>
            {/* Selected repos */}
            {selectedRepos.length > 0 && (
              <div className={styles.inlineSelectedRepos}>
                {selectedRepos.map((repo) => (
                  <Token
                    key={repo.fullName}
                    text={repo.name}
                    onRemove={() => handleRemoveRepo(repo.fullName)}
                    leadingVisual={() => <RepoIcon size={12} />}
                    size="small"
                    className={styles.repoToken}
                  />
                ))}
              </div>
            )}

            {/* Add more */}
            {canAddMore && (
              <div className={styles.inlineSearchWrapper}>
                <TextInput
                  ref={inputRef}
                  value={searchValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onFocus={handleInputFocus}
                  placeholder={placeholder}
                  disabled={disabled}
                  leadingVisual={isLoading ? Spinner : PlusIcon}
                  size="small"
                  aria-label="Add repository"
                  aria-expanded={isOpen}
                  aria-haspopup="listbox"
                  aria-controls={listboxId}
                  aria-activedescendant={
                    safeHighlightedIndex >= 0 ? `repo-option-${safeHighlightedIndex}` : undefined
                  }
                  role="combobox"
                  autoComplete="off"
                  className={styles.inlineSearchInput}
                />

                {/* Dropdown */}
                {isOpen && filteredOptions.length > 0 && (
                  <ul
                    ref={listboxRef}
                    id={listboxId}
                    role="listbox"
                    aria-label="Available repositories"
                    className={styles.listbox}
                  >
                    {filteredOptions.map((repo, index) => (
                      <li
                        key={repo.fullName}
                        id={`repo-option-${index}`}
                        role="option"
                        aria-selected={index === safeHighlightedIndex}
                        className={`${styles.option} ${
                          index === safeHighlightedIndex ? styles.optionHighlighted : ''
                        }`}
                        onClick={() => handleSelectRepo(repo)}
                        onMouseEnter={() => setHighlightedIndex(index)}
                      >
                        <RepoIcon size={14} className={styles.optionIcon} />
                        <span className={styles.optionText}>
                          <span className={styles.optionOwner}>{repo.owner}/</span>
                          <span className={styles.optionName}>{repo.name}</span>
                        </span>
                        {repo.language && (
                          <span className={styles.optionLanguage}>{repo.language}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Standard mode (compact or full)

  return (
    <div ref={containerRef} className={`${styles.container} ${compact ? styles.containerCompact : ''}`}>
      {/* Selected repos as tokens */}
      {selectedRepos.length > 0 && (
        <div className={styles.selectedRepos} role="group" aria-label="Selected repositories">
          {selectedRepos.map((repo) => (
            <Token
              key={repo.fullName}
              text={repo.fullName}
              onRemove={() => handleRemoveRepo(repo.fullName)}
              leadingVisual={() => <RepoIcon size={12} />}
              size={compact ? 'small' : 'medium'}
              className={styles.repoToken}
            />
          ))}
        </div>
      )}

      {/* Combobox input */}
      <div className={styles.inputWrapper}>
        <div style={{ position: 'relative' }}>
          <TextInput
            ref={inputRef}
            value={searchValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            placeholder={canAddMore ? placeholder : `Max ${maxSelections} repos`}
            disabled={disabled || !canAddMore}
            leadingVisual={isLoading ? Spinner : SearchIcon}
            size="small"
            aria-label="Search repositories"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            aria-activedescendant={
              safeHighlightedIndex >= 0 ? `repo-option-${safeHighlightedIndex}` : undefined
            }
            role="combobox"
            autoComplete="off"
            className={`${styles.searchInput} ${compact ? styles.searchInputCompact : ''}`}
          />

          {/* Dropdown listbox */}
          {isOpen && filteredOptions.length > 0 && (
            <ul
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label="Available repositories"
              className={styles.listbox}
            >
              {filteredOptions.map((repo, index) => (
                <li
                  key={repo.fullName}
                  id={`repo-option-${index}`}
                  role="option"
                  aria-selected={index === safeHighlightedIndex}
                  className={`${styles.option} ${
                    index === safeHighlightedIndex ? styles.optionHighlighted : ''
                  }`}
                  onClick={() => handleSelectRepo(repo)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <RepoIcon size={16} className={styles.optionIcon} />
                  <span className={styles.optionText}>
                    <span className={styles.optionOwner}>{repo.owner}/</span>
                    <span className={styles.optionName}>{repo.name}</span>
                  </span>
                  {repo.language && (
                    <span className={styles.optionLanguage}>{repo.language}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Empty state */}
          {isOpen && searchValue && filteredOptions.length === 0 && !isLoading && (
            <div className={styles.emptyState}>
              No repositories found matching &quot;{searchValue}&quot;
            </div>
          )}
        </div>
      </div>

      {/* Help text - hidden in compact mode */}
      {!compact && selectedRepos.length === 0 && (
        <p className={styles.helpText}>
          Add repos to scope Copilot&apos;s context for this thread
        </p>
      )}
    </div>
  );
}
