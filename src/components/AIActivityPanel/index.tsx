'use client';

/**
 * AI Activity Panel
 * 
 * Shows real-time Copilot SDK operations for developer education.
 * Only available when debug mode is enabled.
 * Activated via:
 * - Keyboard: Ctrl+Shift+A (Cmd+Shift+A on Mac)
 * - URL: ?debug=ai
 */

import { useDebugMode } from '@/contexts/debug-context';
import { useAIActivity } from '@/hooks/use-ai-activity';
import { CopyIcon, FilterIcon, ScreenFullIcon, ScreenNormalIcon, SortDescIcon, TrashIcon, XIcon } from '@primer/octicons-react';
import { Button, IconButton, TextInput } from '@primer/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import styles from './AIActivityPanel.module.css';
import { ActivityBadge } from './activity-badge';
import { ActivityEvent } from './activity-event';
import { useActivityFilters, type SortBy } from './use-activity-filters';

type PanelState = 'hidden' | 'badge' | 'docked' | 'fullscreen';

interface AIActivityPanelProps {
  /** Initial state of the panel */
  initialState?: PanelState;
}

const DEFAULT_DOCKED_WIDTH = 450;
const MIN_DOCKED_WIDTH = 300;
const MAX_DOCKED_WIDTH_VIEWPORT_RATIO = 0.8;

// PERF: Memoize expensive component with complex filtering/sorting logic
export const AIActivityPanel = memo(function AIActivityPanel({ initialState = 'hidden' }: AIActivityPanelProps) {
  const { isDebugMode } = useDebugMode();
  const [state, setState] = useState<PanelState>(initialState);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_DOCKED_WIDTH);
  const [isResizeHandleActive, setIsResizeHandleActive] = useState(false);
  const [showEducational, setShowEducational] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const isResizingRef = useRef(false);
  
  const { events, isPaused, setIsPaused, clear, exportJSON, exportMarkdown, stats, pendingCount } =
    useAIActivity({ enabled: isDebugMode });

  // Use extracted filtering hook
  const {
    searchQuery,
    setSearchQuery,
    operationFilter,
    setOperationFilter,
    modelFilter,
    setModelFilter,
    sortBy,
    setSortBy,
    showFilters,
    setShowFilters,
    uniqueOperations,
    uniqueModels,
    filteredAndSortedEvents,
  } = useActivityFilters(events);

  // Auto-show badge when first event comes in - use ref to track
  const hasShownBadge = useRef(state !== 'hidden');

  // Keyboard shortcut: Ctrl+Shift+A (Cmd+Shift+A on Mac) - only in debug mode
  useEffect(() => {
    if (!isDebugMode) return;
    
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setState((prev) => {
          if (prev === 'hidden') return 'docked';
          if (prev === 'badge') return 'docked';
          return 'hidden';
        });
      }
      // Escape to close
      if (e.key === 'Escape' && (state === 'docked' || state === 'fullscreen')) {
        setState('badge');
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [state, isDebugMode]);

  // Check URL param on mount for initial state
  useEffect(() => {
    if (typeof window !== 'undefined' && initialState === 'hidden') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === 'ai') {
        // This is acceptable since it's transitioning from initial state
        queueMicrotask(() => setState('docked'));
      }
    }
    // NOTE: Intentionally empty deps - this effect reads URL params only on initial mount.
    // Including `initialState` would cause re-runs when state changes, which is undesired
    // since URL params should only be checked once at component load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (events.length > 0 && state === 'hidden' && !hasShownBadge.current) {
      hasShownBadge.current = true;
      queueMicrotask(() => setState('badge'));
    }
  }, [events.length, state]);

  const handleCopyJSON = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportJSON());
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback('Failed');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [exportJSON]);

  const handleCopyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportMarkdown());
      setCopyFeedback('Copied MD!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback('Failed');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [exportMarkdown]);

  const getClampedPanelWidth = useCallback((nextWidth: number): number => {
    const maxDockedWidth = window.innerWidth * MAX_DOCKED_WIDTH_VIEWPORT_RATIO;
    return Math.min(maxDockedWidth, Math.max(MIN_DOCKED_WIDTH, nextWidth));
  }, []);

  const handleResizeMouseMove = useCallback((event: MouseEvent) => {
    if (!isResizingRef.current) return;
    const nextWidth = window.innerWidth - event.clientX;
    setPanelWidth(getClampedPanelWidth(nextWidth));
  }, [getClampedPanelWidth]);

  const handleResizeMouseUp = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    setIsResizeHandleActive(false);
    window.removeEventListener('mousemove', handleResizeMouseMove);
    window.removeEventListener('mouseup', handleResizeMouseUp);
  }, [handleResizeMouseMove]);

  const handleResizeMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isResizingRef.current = true;
    setIsResizeHandleActive(true);
    window.addEventListener('mousemove', handleResizeMouseMove);
    window.addEventListener('mouseup', handleResizeMouseUp);
  }, [handleResizeMouseMove, handleResizeMouseUp]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleResizeMouseMove);
      window.removeEventListener('mouseup', handleResizeMouseUp);
    };
  }, [handleResizeMouseMove, handleResizeMouseUp]);

  // Don't show panel at all if debug mode is off
  if (!isDebugMode) {
    return null;
  }

  // Hidden state - just show hint
  if (state === 'hidden') {
    return (
      <div
        className={styles.hiddenHint}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.4')}
      >
        <button
          onClick={() => setState('badge')}
          className={`f6 color-fg-muted ${styles.hiddenHintButton}`}
        >
          ⌘+Shift+A for AI Activity
        </button>
      </div>
    );
  }

  // Badge state - floating compact badge
  if (state === 'badge') {
    return (
      <ActivityBadge
        count={events.length}
        pendingCount={pendingCount}
        onClick={() => setState('docked')}
      />
    );
  }

  // Docked or Fullscreen - full panel
  const isFullscreen = state === 'fullscreen';

  return (
    <div
      className={`${styles.panel} ${isFullscreen ? styles.panelFullscreen : styles.panelDocked}`}
      style={isFullscreen ? undefined : { width: panelWidth }}
    >
      {!isFullscreen && (
        <div
          className={`${styles.resizeHandle} ${isResizeHandleActive ? styles.resizeHandleActive : ''}`}
          onMouseDown={handleResizeMouseDown}
          aria-hidden="true"
        />
      )}
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>🔍 AI Activity</span>
        <span className="f6 color-fg-muted">
          {pendingCount > 0 && `${pendingCount} running`}
        </span>
        <div className={styles.headerSpacer} />
        <Button size="small" onClick={() => setIsPaused(!isPaused)}>
          {isPaused ? '▶ Resume' : '⏸ Pause'}
        </Button>
        <IconButton
          icon={isFullscreen ? ScreenNormalIcon : ScreenFullIcon}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          size="small"
          onClick={() => setState(isFullscreen ? 'docked' : 'fullscreen')}
        />
        <IconButton
          icon={XIcon}
          aria-label="Close panel"
          size="small"
          onClick={() => setState('badge')}
        />
      </div>

      {/* Settings bar */}
      <div className={styles.settingsBar}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showEducational}
            onChange={(e) => setShowEducational(e.target.checked)}
          />
          <span>Show explanations</span>
        </label>
        <div className={styles.searchWrapper}>
          <TextInput
            size="small"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%' }}
            aria-label="Search events"
          />
        </div>
        <IconButton
          icon={FilterIcon}
          aria-label="Toggle filters"
          size="small"
          onClick={() => setShowFilters(!showFilters)}
          style={{
            backgroundColor: showFilters ? 'var(--bgColor-accent-muted)' : undefined,
          }}
        />
        <IconButton
          icon={SortDescIcon}
          aria-label="Change sort"
          size="small"
          onClick={() => {
            const sortOptions: SortBy[] = ['time-desc', 'latency-desc', 'ttft-desc', 'time-asc', 'latency-asc', 'ttft-asc'];
            const currentIndex = sortOptions.indexOf(sortBy);
            const nextIndex = (currentIndex + 1) % sortOptions.length;
            setSortBy(sortOptions[nextIndex]);
          }}
        />
      </div>

      {/* Filters panel (collapsible) */}
      {showFilters && (
        <div className={styles.filtersPanel}>
          <div className={styles.filterGroup}>
            <label htmlFor="ai-activity-operation-filter" className="color-fg-muted">Operation:</label>
            <select
              id="ai-activity-operation-filter"
              value={operationFilter}
              onChange={(e) => setOperationFilter(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="all">All operations</option>
              {uniqueOperations.map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
          
          <div className={styles.filterGroup}>
            <label htmlFor="ai-activity-model-filter" className="color-fg-muted">Model:</label>
            <select
              id="ai-activity-model-filter"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="all">All models</option>
              {uniqueModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor="ai-activity-sort-filter" className="color-fg-muted">Sort by:</label>
            <select
              id="ai-activity-sort-filter"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className={styles.filterSelect}
            >
              <option value="time-desc">Newest first</option>
              <option value="time-asc">Oldest first</option>
              <option value="latency-desc">Slowest first</option>
              <option value="latency-asc">Fastest first</option>
              <option value="ttft-desc">Slowest TTFT</option>
              <option value="ttft-asc">Fastest TTFT</option>
            </select>
          </div>

          {(searchQuery || operationFilter !== 'all' || modelFilter !== 'all') && (
            <Button
              size="small"
              variant="invisible"
              onClick={() => {
                setSearchQuery('');
                setOperationFilter('all');
                setModelFilter('all');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Events List */}
      <div className={styles.eventsList}>
        {filteredAndSortedEvents.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>
              {events.length === 0 ? '🤖' : '🔍'}
            </div>
            <div className={`color-fg-muted ${styles.emptyStateText}`}>
              {events.length === 0 ? (
                <>
                  No AI activity yet.
                  <br />
                  Interact with the dashboard to see SDK calls.
                </>
              ) : (
                <>
                  No events match your filters.
                  <br />
                  Try adjusting your search or filters.
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {filteredAndSortedEvents.length < events.length && (
              <div className={`f6 color-fg-muted ${styles.filterNotice}`}>
                Showing {filteredAndSortedEvents.length} of {events.length} events
              </div>
            )}
            {filteredAndSortedEvents.map((event) => (
              <ActivityEvent key={event.id} event={event} showEducational={showEducational} />
            ))}
          </>
        )}
      </div>

      {/* Footer Stats */}
      <div className={styles.footer}>
        {/* Stats row */}
        <div className="d-flex gap-3 mb-2" style={{ flexWrap: 'wrap' }}>
          <span className="f6 color-fg-muted">
            <strong>{stats.total}</strong> calls
          </span>
          <span className="f6 color-fg-muted">
            <strong>{stats.avgLatency}</strong>ms avg
          </span>
          <span className="f6 color-fg-muted">
            <strong>{stats.totalTokens.toLocaleString()}</strong> tokens
          </span>
        </div>

        {/* Actions row */}
        <div className="d-flex gap-2" style={{ flexWrap: 'wrap' }}>
          <Button size="small" variant="danger" leadingVisual={TrashIcon} onClick={clear}>
            Clear
          </Button>
          <Button size="small" leadingVisual={CopyIcon} onClick={handleCopyJSON}>
            {copyFeedback || 'Copy JSON'}
          </Button>
          <Button size="small" onClick={handleCopyMarkdown}>
            Copy Markdown
          </Button>
        </div>
      </div>
    </div>
  );
});
