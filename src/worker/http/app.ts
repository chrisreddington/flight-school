/**
 * Hono app factory for the worker.
 *
 * Mounts all `/api/internal/*` routes behind bearer middleware and the
 * unauthenticated `/api/health` probe outside it. `x-user-id` is required
 * only on the ai-activity and per-job streaming groups.
 *
 * `createWorkerApp()` returns the Hono instance without starting a
 * server, so tests can use `app.request(new Request(...))`.
 */

import { Hono } from 'hono';

import { withExtractedTraceContext } from '@/lib/observability/context-propagation';

import { checkBearer, requireUserId } from './auth';
import { handleActivityDelete, handleActivityGet } from './handlers/activity';
import { handleActivityEventCreate, handleActivityEventPatch } from './handlers/activity-event';
import { handleActivityStream } from './handlers/activity-stream';
import { handleCopilotAuthoring } from './handlers/copilot-authoring';
import { handleCopilotCoach } from './handlers/copilot-coach';
import { handleCopilotExecute } from './handlers/copilot-execute';
import { handleJobsCreate, handleJobsList } from './handlers/jobs';
import { handleJobDelete, handleJobGet } from './handlers/jobs-by-id';
import { handleJobStream } from './handlers/jobs-stream';
import { handleJobsSweep } from './handlers/jobs-sweep';
import { handleJobsUserDataDelete, handleJobsUserDataGet } from './handlers/jobs-user-data';

type WorkerEnv = { Variables: { userId: string } };

export function createWorkerApp(): Hono<WorkerEnv> {
  const app = new Hono<WorkerEnv>();

  // Unauthenticated health probe — must be registered BEFORE the bearer
  // middleware. ACA liveness/readiness/startup probes hit `/api/health`.
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Global bearer guard on /api/internal/*.
  app.use('/api/internal/*', async (c, next) => {
    const denied = checkBearer(c.req.raw);
    if (denied) return denied;
    await next();
  });

  // Per-group `x-user-id` guard. Applied to the ai-activity collection,
  // its sub-routes, and the per-job stream. Body/query routes parse the
  // subject themselves and are not on this middleware.
  const xUserIdMiddleware = async (
    c: { req: { raw: Request }; set: (k: 'userId', v: string) => void },
    next: () => Promise<void>,
  ) => {
    const result = requireUserId(c.req.raw);
    if (!result.ok) return result.response;
    c.set('userId', result.userId);
    await next();
  };
  app.use('/api/internal/ai-activity', xUserIdMiddleware);
  app.use('/api/internal/ai-activity/*', xUserIdMiddleware);
  app.use('/api/internal/jobs/:id/stream', xUserIdMiddleware);

  /** Bridge a (Request, ...args) handler through trace-context extraction. */
  const traced =
    <A extends unknown[]>(handler: (req: Request, ...args: A) => Promise<Response> | Response, ...args: A) =>
    (request: Request) =>
      withExtractedTraceContext(request.headers, async () => handler(request, ...args));

  // Copilot execution.
  app.post('/api/internal/copilot/execute', (c) => traced(handleCopilotExecute)(c.req.raw));
  app.post('/api/internal/copilot/coach', (c) => traced(handleCopilotCoach)(c.req.raw));
  app.post('/api/internal/copilot/authoring', (c) => traced(handleCopilotAuthoring)(c.req.raw));

  // Jobs collection.
  app.get('/api/internal/jobs', (c) => traced(handleJobsList)(c.req.raw));
  app.post('/api/internal/jobs', (c) => traced(handleJobsCreate)(c.req.raw));
  app.post('/api/internal/jobs/sweep', (c) => traced(handleJobsSweep)(c.req.raw));

  // Jobs user-data export/purge.
  app.get('/api/internal/jobs/user-data', (c) => traced(handleJobsUserDataGet)(c.req.raw));
  app.delete('/api/internal/jobs/user-data', (c) => traced(handleJobsUserDataDelete)(c.req.raw));

  // Single job.
  app.get('/api/internal/jobs/:id', (c) => {
    const id = c.req.param('id');
    return traced(handleJobGet, id)(c.req.raw);
  });
  app.delete('/api/internal/jobs/:id', (c) => {
    const id = c.req.param('id');
    return traced(handleJobDelete, id)(c.req.raw);
  });
  app.get('/api/internal/jobs/:id/stream', (c) => {
    const id = c.req.param('id');
    const userId = c.get('userId');
    return traced(handleJobStream, id, userId)(c.req.raw);
  });

  // AI activity (all require x-user-id).
  app.get('/api/internal/ai-activity', (c) => {
    const userId = c.get('userId');
    return traced(handleActivityGet, userId)(c.req.raw);
  });
  app.delete('/api/internal/ai-activity', (c) => {
    const userId = c.get('userId');
    return traced(handleActivityDelete, userId)(c.req.raw);
  });
  app.post('/api/internal/ai-activity/event', (c) => {
    const userId = c.get('userId');
    return traced(handleActivityEventCreate, userId)(c.req.raw);
  });
  app.patch('/api/internal/ai-activity/event/:id', (c) => {
    const id = c.req.param('id');
    const userId = c.get('userId');
    return traced(handleActivityEventPatch, id, userId)(c.req.raw);
  });
  app.get('/api/internal/ai-activity/stream', (c) => {
    const userId = c.get('userId');
    return traced(handleActivityStream, userId)(c.req.raw);
  });

  return app;
}
