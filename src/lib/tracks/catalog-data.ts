/**
 * The curated, static Tracks catalog (§B.1).
 *
 * This is the single source of course content: the same for every user, shipped
 * as code rather than per-user storage. It is *data only* — no validation logic
 * lives here. {@link loadCatalog} in `./catalog` is the sole entry point and
 * validates every id against the safe-segment class, so consumers never read
 * `CATALOG` directly.
 *
 * Bump {@link CATALOG_VERSION} whenever any track or step changes; the new
 * value is stamped onto enrollments so progress records which revision a
 * learner enrolled against.
 *
 * @module tracks/catalog-data
 */

import type { Track } from './types';

/**
 * Opaque catalog revision. Bump on ANY content change (add/remove/reorder a
 * track or step, edit copy). Date-stamped for at-a-glance ordering.
 */
export const CATALOG_VERSION = '2026-05-30';

/**
 * The curated tracks. Array order within each track's `steps` IS the canonical
 * step order used by current-step derivation.
 */
export const CATALOG: readonly Track[] = [
  {
    trackId: 'github-foundations',
    title: 'GitHub Foundations',
    description:
      'Get comfortable with the day-to-day GitHub flow: repositories, commits, ' + 'branches, and pull requests.',
    steps: [
      {
        stepId: 'repos-and-commits',
        title: 'Repositories and commits',
        summary: 'Create a repository and record your first commits with clear messages.',
      },
      {
        stepId: 'branches',
        title: 'Working in branches',
        summary: 'Isolate work on a branch and understand how branches diverge and merge.',
      },
      {
        stepId: 'pull-requests',
        title: 'Pull requests',
        summary: 'Open a pull request, request review, and merge with confidence.',
      },
    ],
  },
  {
    trackId: 'automating-with-actions',
    title: 'Automating with GitHub Actions',
    description:
      'Turn manual chores into automated workflows: from a first CI run to ' + 'reusable, event-driven automation.',
    steps: [
      {
        stepId: 'first-workflow',
        title: 'Your first workflow',
        summary: 'Author a workflow file and watch it run on push.',
      },
      {
        stepId: 'ci-checks',
        title: 'Continuous integration checks',
        summary: 'Run lint and tests on every pull request to guard the default branch.',
      },
      {
        stepId: 'events-and-triggers',
        title: 'Events and triggers',
        summary: 'Drive workflows from the events that matter to your project.',
      },
    ],
  },
];
