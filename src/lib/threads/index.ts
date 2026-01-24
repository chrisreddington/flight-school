/**
 * Threads Module
 *
 * Multi-thread chat system with server-side JSON persistence.
 * Provides types, storage, and utilities for managing chat threads.
 *
 * @example
 * ```typescript
 * import { threadStore, type Thread } from '@/lib/threads';
 *
 * const thread = await threadStore.create({ title: 'Learning React' });
 * const all = await threadStore.getAll();
 * ```
 */

// Types
export type {
    CreateThreadOptions,
    Message,
    RepoReference,
    Thread,
    ThreadContext
} from './types';

// Storage
export { threadStore } from './storage';

