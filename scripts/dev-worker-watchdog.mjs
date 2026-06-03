/**
 * Dev-only parent-death watchdog for the standalone Copilot worker.
 *
 * Loaded via `node --import` into the worker child that
 * `scripts/dev-worker.mjs` spawns. Its single job: terminate this worker
 * the instant its supervisor disappears, so an orphaned worker can never
 * keep squatting port 3001 and crash-loop the replacement with EADDRINUSE.
 *
 * Why a child-side watchdog is required: the supervisor already stops the
 * worker gracefully on SIGINT/SIGTERM, but that path never runs when the
 * supervisor dies UNcatchably — SIGKILL, an Aspire force-stop, a crash, or
 * `npm` failing to forward the stop signal. In those cases the worker is
 * re-parented to launchd/init and lingers. Polling for the parent PID would
 * work but races; instead the supervisor opens an IPC channel to the child,
 * and the OS closes our end of that pipe the moment the parent process dies
 * — however it died. We listen for that `disconnect` and exit, releasing the
 * port immediately. This is the userland equivalent of Linux's
 * `PR_SET_PDEATHSIG`, and it is inert in production (the production worker is
 * spawned without an IPC channel, so `process.connected` is false).
 */
if (process.connected) {
  // Don't let the IPC handle alone keep the worker alive; the HTTP server
  // already does, and unref'ing lets a graceful shutdown exit promptly while
  // `disconnect` still fires (the event loop stays alive via the server).
  process.channel?.unref?.();
  process.once('disconnect', () => {
    process.stderr.write('[dev-worker] supervisor disconnected — exiting orphaned worker to free port\n');
    process.exit(0);
  });
}
