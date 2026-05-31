/**
 * Legacy-source descriptors for the storage importer.
 *
 * @remarks
 * Each {@link ContainerDescriptor} knows how to enumerate the legacy ids for
 * one S1 container and load a single legacy body by id. Keeping this layer in
 * its own module isolates the "what to migrate" knowledge (file layout, id
 * safety, JSON parsing, the workspace leaf) from the "how to apply" conflict
 * policy in `migrate.ts`.
 *
 * @module storage/migrate-descriptors
 */

import { logger } from '@/lib/logger';
import type { ContainerName } from '@/lib/storage/document-store/types';
import {
  MIGRATABLE_SINGLETON_FILENAMES,
  resolveContainerMapping,
} from '@/lib/storage/document-store/user-storage-core';
import { SAFE_PATH_SEGMENT } from '@/lib/storage/user-scope';
import { listDirs, listFiles, readFile } from '@/lib/storage/utils';
import {
  readLegacyWorkspaceTree,
  WORKSPACES_DIR,
  type LegacyReadRaw,
  type LegacyWarn,
} from '@/lib/workspace/legacy-tree';

const log = logger.withTag('storage-migrate');

/** The legacy directory (under a user's root) that holds challenge specs. */
const CHALLENGES_DIR = 'challenges';

/**
 * Enumerates legacy ids for one container and loads each legacy body. A `null`
 * body signals a corrupt or absent source the caller tallies as skipped.
 */
export interface ContainerDescriptor {
  container: ContainerName;
  enumerateIds(userId: string): Promise<string[]>;
  loadLegacyBody(userId: string, id: string): Promise<unknown | null>;
}

/** Reads a legacy file relative to a user's root, for the workspace leaf. */
function buildReadRaw(userId: string): LegacyReadRaw {
  return (relativePath) => readFile(`users/${userId}`, relativePath);
}

/** Forwards leaf warnings into the importer's tagged logger. */
const forwardWarn: LegacyWarn = (message, context) => log.warn(message, context);

/** Parses a legacy JSON file body, warning and returning null when invalid. */
function parseLegacyJson(raw: string | null, context: Record<string, unknown>): unknown | null {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    log.warn('Legacy file is not valid JSON; skipping', context);
    return null;
  }
}

/** Builds descriptors for the five singleton containers from the canonical map. */
function singletonDescriptors(): ContainerDescriptor[] {
  return MIGRATABLE_SINGLETON_FILENAMES.map((filename) => {
    const mapping = resolveContainerMapping(filename);
    if (mapping === null) {
      throw new Error(`Singleton filename ${filename} has no container mapping`);
    }
    return {
      container: mapping.container,
      async enumerateIds(userId) {
        const raw = await readFile(`users/${userId}`, filename);
        return raw === null ? [] : [mapping.id];
      },
      async loadLegacyBody(userId) {
        const raw = await readFile(`users/${userId}`, filename);
        return parseLegacyJson(raw, { filename });
      },
    };
  });
}

/** Descriptor for by-id challenge specs under `users/{userId}/challenges`. */
function challengesDescriptor(): ContainerDescriptor {
  return {
    container: 'challenges',
    async enumerateIds(userId) {
      const files = await listFiles(`users/${userId}/${CHALLENGES_DIR}`);
      const ids: string[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }
        const id = file.slice(0, -'.json'.length);
        if (!SAFE_PATH_SEGMENT.test(id)) {
          log.warn('Skipping legacy challenge spec with unsafe id', { file });
          continue;
        }
        ids.push(id);
      }
      return ids;
    },
    async loadLegacyBody(userId, id) {
      const raw = await readFile(`users/${userId}`, `${CHALLENGES_DIR}/${id}.json`);
      return parseLegacyJson(raw, { challengeId: id });
    },
  };
}

/** Descriptor for by-id workspace trees, reassembled via the shared leaf. */
function workspacesDescriptor(): ContainerDescriptor {
  return {
    container: 'workspaces',
    async enumerateIds(userId) {
      const dirs = await listDirs(`users/${userId}/${WORKSPACES_DIR}`);
      return dirs.filter((dir) => {
        if (SAFE_PATH_SEGMENT.test(dir)) {
          return true;
        }
        log.warn('Skipping legacy workspace with unsafe id', { dir });
        return false;
      });
    },
    loadLegacyBody(userId, id) {
      return readLegacyWorkspaceTree(buildReadRaw(userId), forwardWarn, userId, id);
    },
  };
}

/** All S1 descriptors in deterministic order (singletons, then by-id). */
export function allDescriptors(): ContainerDescriptor[] {
  return [...singletonDescriptors(), challengesDescriptor(), workspacesDescriptor()];
}

/** Resolves the set of user ids to process, honouring a single-user filter. */
export async function enumerateUsers(filter: string | undefined): Promise<string[]> {
  if (filter !== undefined) {
    return [filter];
  }
  const dirs = await listDirs('users');
  return dirs.filter((dir) => {
    if (SAFE_PATH_SEGMENT.test(dir)) {
      return true;
    }
    log.warn('Skipping user directory with unsafe id', { dir });
    return false;
  });
}
