/**
 * useActivityFilters Hook
 * 
 * Manages filtering and sorting state for AI activity events.
 * Extracted from AIActivityPanel for better separation of concerns.
 */

import { useMemo, useState } from 'react';
import type { AIActivityEvent } from '@/lib/copilot/activity/types';

export type SortBy = 'time-desc' | 'time-asc' | 'latency-desc' | 'latency-asc' | 'ttft-desc' | 'ttft-asc';

interface UseActivityFiltersResult {
  /** Current search query */
  searchQuery: string;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Current operation filter */
  operationFilter: string;
  /** Set operation filter */
  setOperationFilter: (filter: string) => void;
  /** Current model filter */
  modelFilter: string;
  /** Set model filter */
  setModelFilter: (filter: string) => void;
  /** Current sort option */
  sortBy: SortBy;
  /** Set sort option */
  setSortBy: (sort: SortBy) => void;
  /** Whether to show filters UI */
  showFilters: boolean;
  /** Toggle filters UI */
  setShowFilters: (show: boolean) => void;
  /** Unique operations from events */
  uniqueOperations: string[];
  /** Unique models from events */
  uniqueModels: string[];
  /** Filtered and sorted events */
  filteredAndSortedEvents: AIActivityEvent[];
}

/**
 * Hook for managing activity event filters and sorting.
 * 
 * @param events - Raw activity events to filter and sort
 * @returns Filter state and filtered/sorted events
 */
export function useActivityFilters(events: AIActivityEvent[]): UseActivityFiltersResult {
  const [searchQuery, setSearchQuery] = useState('');
  const [operationFilter, setOperationFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortBy>('time-desc');
  const [showFilters, setShowFilters] = useState(false);

  // Extract unique operations and models for filters
  const { uniqueOperations, uniqueModels } = useMemo(() => {
    const operations = new Set<string>();
    const models = new Set<string>();
    
    events.forEach(event => {
      operations.add(event.operation);
      if (event.input?.model) {
        models.add(event.input.model);
      }
    });
    
    return {
      uniqueOperations: Array.from(operations).sort(),
      uniqueModels: Array.from(models).sort(),
    };
  }, [events]);

  // Filter and sort events
  const filteredAndSortedEvents = useMemo(() => {
    let filtered = events;

    // Text search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(event => 
        event.operation.toLowerCase().includes(query) ||
        event.input?.prompt?.toLowerCase().includes(query) ||
        event.output?.text?.toLowerCase().includes(query) ||
        event.input?.model?.toLowerCase().includes(query)
      );
    }

    // Operation filter
    if (operationFilter !== 'all') {
      filtered = filtered.filter(event => event.operation === operationFilter);
    }

    // Model filter
    if (modelFilter !== 'all') {
      filtered = filtered.filter(event => event.input?.model === modelFilter);
    }

    // Sorting
    const sorted = [...filtered];
    switch (sortBy) {
      case 'time-desc':
        sorted.reverse(); // Events are already newest-first in the array
        break;
      case 'time-asc':
        // Keep original order (oldest first)
        break;
      case 'latency-desc':
        sorted.sort((a, b) => b.latencyMs - a.latencyMs);
        break;
      case 'latency-asc':
        sorted.sort((a, b) => a.latencyMs - b.latencyMs);
        break;
      case 'ttft-desc':
        sorted.sort((a, b) => {
          const aTime = a.output?.metadata?.firstTokenMs as number | undefined;
          const bTime = b.output?.metadata?.firstTokenMs as number | undefined;
          if (aTime == null) return 1;
          if (bTime == null) return -1;
          return bTime - aTime;
        });
        break;
      case 'ttft-asc':
        sorted.sort((a, b) => {
          const aTime = a.output?.metadata?.firstTokenMs as number | undefined;
          const bTime = b.output?.metadata?.firstTokenMs as number | undefined;
          if (aTime == null) return 1;
          if (bTime == null) return -1;
          return aTime - bTime;
        });
        break;
    }

    return sorted;
  }, [events, searchQuery, operationFilter, modelFilter, sortBy]);

  return {
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
  };
}
