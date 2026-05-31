/**
 * Per-user focus-storage repository — the single source of truth for the focus
 * singleton's filename, default, and schema guard.
 *
 * Before S1, the storage route at `app/api/focus/storage/route.ts` re-declared
 * its own `validateSchema` guard and `focus-storage.json` / `{ history: {} }`
 * pair. {@link focusRepo} collapses that into one typed accessor so the route
 * cannot drift from the document store's expectations.
 *
 * Focus has no server-side reader (the `focusStore` in `./storage` reads
 * through the browser client in `./persistence`) and no Server Actions, so the
 * route is this repo's only consumer today. Like `habitsRepo`, the schema
 * carries no server-stamped field, so this repo configures no `stamp`.
 *
 * @module focus/repo
 */

import { createSingletonRepo } from '@/lib/storage/document-store/singleton-repo';
import type { FocusStorageSchema } from './types';

const DEFAULT_FOCUS_STORAGE: FocusStorageSchema = { history: {} };

/**
 * Validate the persisted focus-storage shape. A document failing this guard is
 * treated as absent (read heals to the default; write is rejected).
 */
export function isFocusStorageSchema(value: unknown): value is FocusStorageSchema {
  if (typeof value !== 'object' || value === null) return false;
  const schema = value as Record<string, unknown>;
  return typeof schema.history === 'object' && schema.history !== null;
}

/**
 * Server-side focus-storage accessor. The storage route consumes this repo's
 * {@link SingletonRepo.filename}, {@link SingletonRepo.defaultValue}, and
 * {@link SingletonRepo.guard}.
 */
export const focusRepo = createSingletonRepo<FocusStorageSchema>({
  filename: 'focus-storage.json',
  defaultValue: DEFAULT_FOCUS_STORAGE,
  guard: isFocusStorageSchema,
});
