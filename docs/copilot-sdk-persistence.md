# Copilot SDK persistence: keep `infiniteSessions` enabled

> [!WARNING]
> **Exploratory project — not a reference.** This is a design note from a
> single-developer side project. The reasoning below reflects the current
> tradeoffs in this experiment; it is **not** general guidance for using the
> Copilot SDK in production.

> **Status:** Decision (Phase C of the multi-tenant data-minimization plan).
> **Date:** 2024-11.

## TL;DR

We deliberately do **not** disable `infiniteSessions` on `CopilotClient`.
The flag controls automatic background compaction; turning it off would
break long chats well before any privacy or storage benefit kicked in.

We do not pass `sessionFs` either, so the SDK keeps its session-state
files in the container's local filesystem (`~/.copilot/session-state/{id}/`
by default). On Azure Container Apps this disk is per-replica and
ephemeral — restarts wipe it, which matches our threat model.

## What `infiniteSessions` actually controls

From `@github/copilot-sdk` v1.0.0-beta.4 (`dist/types.d.ts`):

```ts
export interface InfiniteSessionConfig {
    /**
     * Whether infinite sessions are enabled.
     * @default true
     */
    enabled?: boolean;
    /**
     * Context utilization threshold (0.0-1.0) at which background
     * compaction starts. Compaction runs asynchronously, allowing the
     * session to continue processing.
     * @default 0.80
     */
    backgroundCompactionThreshold?: number;
    /**
     * Context utilization threshold (0.0-1.0) at which the session
     * blocks until compaction completes. This prevents context
     * overflow when compaction hasn't finished in time.
     * @default 0.95
     */
    bufferExhaustionThreshold?: number;
}
```

`enabled: false` removes both thresholds — there is no separate
"compaction-in-memory" mode. Once the context window fills, the
session errors instead of compacting.

## Decision tree (rubber-duck #17 / C2)

| If compaction is…              | Then…                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| In-memory                      | Flip `{ enabled: false }`, drop the on-disk workspace path, no sweeper needed.       |
| On-disk                        | Keep enabled, add a workspace sweeper to `/api/cron/sweep` with a TTL.               |
| **Ambiguous (current state)**  | **Keep current behaviour (default-on); revisit after stress-testing long chats.**    |

Our reading of the SDK source is that compaction *itself* is in-memory
(the session keeps replying immediately while the model summarises
prior turns in the background), but the resulting summary plus
checkpoint metadata is written under the session-state directory.
Disabling the flag therefore both:

1. Removes the in-memory compaction step → long chats die at
   `bufferExhaustionThreshold`.
2. Removes the on-disk checkpoint writes → no privacy upside, since
   without compaction we never accumulate a long-running session
   worth checkpointing anyway.

There is no version of "off" that buys us privacy without breaking
chat. We therefore **keep the SDK default**.

## What we DO sweep

The cron sweeper (`/api/cron/sweep`) already handles every category
of server-side state we own:

- per-user threads (7d inactivity)
- per-user evaluations (24h after terminal state)
- per-job streaming scratchpads (1h after terminal)
- stale `running` / `pending` jobs (6h with no progress, marked failed)
- pre-Phase-A orphan jobs (no `userId`)

The SDK's own `~/.copilot/session-state/{id}/` directory is **not**
swept by us. On ACA this is an ephemeral per-replica volume, so the
data is bounded by replica lifetime; for local dev it sits under the
developer's home and is washed away by `aspire stop` / a fresh `npm
run dev` in a clean shell.

If we ever switch to a hosting model with a long-lived persistent
volume backing `~/.copilot/`, we will revisit this and add a
workspace-state TTL to the cron sweeper. The hook point is
`sweepStaleRunningJobs` in `src/lib/storage/retention.ts`.

## Related code

- `src/lib/copilot/sessions.ts` — `getCopilotClient()` constructs the
  client with no `infiniteSessions` and no `sessionFs` overrides.
- `src/lib/storage/retention.ts` — server-side retention sweeps.
- `src/app/api/cron/sweep/route.ts` — invokes the sweeps on a cadence.
