/**
 * Focus Module
 *
 * Barrel exports for the focus persistence system.
 *
 * @remarks
 * This module is client-side only - uses localStorage.
 * Import only from hooks or components.
 *
 * @example
 * ```typescript
 * import { focusStore } from '@/lib/focus';
 *
 * const cached = focusStore.getTodaysFocus();
 * const history = focusStore.getHistory();
 * ```
 */

// Storage
export { focusStore } from './storage';
