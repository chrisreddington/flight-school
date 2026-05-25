# Storage migration: single-tenant → per-user partitioning

## What changed

Before: storage routes (`/api/threads/storage`, `/api/focus/storage`,
`/api/workspace/storage`) wrote a single shared file at the storage root:

```text
{FLIGHT_SCHOOL_DATA_DIR}/threads.json
{FLIGHT_SCHOOL_DATA_DIR}/focus-storage.json
{FLIGHT_SCHOOL_DATA_DIR}/workspaces/{challengeId}/...
```

In a multi-tenant deployment this meant User A could read or overwrite User
B's conversations, focus history, and workspace files.

After: every storage route resolves the authenticated user via
`requireUserContext()` and rewrites the path to live under a per-user
subdirectory:

```text
{FLIGHT_SCHOOL_DATA_DIR}/users/{userId}/threads.json
{FLIGHT_SCHOOL_DATA_DIR}/users/{userId}/focus-storage.json
{FLIGHT_SCHOOL_DATA_DIR}/users/{userId}/workspaces/{challengeId}/...
```

The `userId` is the numeric GitHub ID from the Auth.js session, validated
against `/^[a-zA-Z0-9_-]+$/` before it is used as a path segment. The
per-user directory is created on demand with mode `0o700`.

## Migration policy

**No automatic migration.** Pre-existing files at the storage root (the
single-tenant layout) are ignored by the multi-tenant code. This is safe
because the multi-tenant version has not been deployed.

Developers cleaning up local environments can delete the old files manually.
On macOS/Linux the default storage location is
`~/.local/share/flight-school/`:

```sh
rm -f ~/.local/share/flight-school/threads.json
rm -f ~/.local/share/flight-school/focus-storage.json
rm -rf ~/.local/share/flight-school/workspaces/
```

On Windows the default is `%LOCALAPPDATA%\flight-school\`.

If you ever need to migrate real user data (e.g. in a future deployed
environment), the mapping is straightforward — copy each top-level
`threads.json` / `focus-storage.json` / `workspaces/` into the appropriate
`users/{userId}/` directory — but doing so requires an offline mapping from
filesystem files to GitHub user IDs that does not exist today.

## See also

- [`docs/architecture-multitenant.md`](../../../docs/architecture-multitenant.md#storage-isolation)
  — full description of the storage isolation guarantee.
- [`storage-route-factory.ts`](./storage-route-factory.ts) — implementation.
- [`storage-route-factory.test.ts`](./storage-route-factory.test.ts) — leak tests.
