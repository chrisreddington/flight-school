// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev

import { createBuilder, EndpointProperty } from './.modules/aspire.js';

async function main(): Promise<void> {
  const builder = await createBuilder();

  const acaEnv = await builder.addAzureContainerAppEnvironment('aca-env');
  await acaEnv.withAzdResourceNaming();

  // In production, the cron Job is provisioned via Bicep (see
  // `infra/modules/cron-job.bicep`) and authenticated with an Entra-issued
  // bearer token. Locally we expose a "Sweep retention" custom dashboard
  // command that POSTs to the cron endpoint with `CRON_SKIP_AUTH=1`; the
  // route honours the bypass only when `NODE_ENV !== 'production'`.
  const workerSecret = 'local-dev-worker-secret';
  // Worker is a standalone Hono/Node process — addExecutable, not
  // addNextJsApp. Mirrors the deployed image (`Dockerfile.worker` over
  // `dist-worker/`). See decision 2 in `docs/architecture.md`.
  const copilotWorker = await builder
    .addExecutable('copilot-worker', 'npm', '.', ['run', 'dev:worker'])
    .withHttpEndpoint({ port: 3001, targetPort: 3001, isProxied: false })
    .withEnvironment('COPILOT_WORKER_SECRET', workerSecret)
    // Pin the listen port explicitly. The worker reads PORT first (ACA
    // convention), so without this an inherited PORT (e.g. dev shell set
    // to 3000) would collide with the targetPort declared above.
    .withEnvironment('PORT', '3001')
    // Distinct OTEL service name so dashboards/logs/traces can tell the
    // worker apart from the web tier — without this both processes emit
    // `service.name=flight-school` and every startup log line appears
    // duplicated.
    .withEnvironment('OTEL_SERVICE_NAME', 'flight-school-worker');
  const workerEndpoint = await copilotWorker.getEndpoint('http');
  const workerUrl = await workerEndpoint.property(EndpointProperty.Url);

  const flightSchool = await builder
    .addNextJsApp('flight-school', '.', { runScriptName: 'dev:web-only' })
    .withHttpEndpoint({ port: 3000, targetPort: 3000, isProxied: false })
    .withExternalHttpEndpoints()
    .withEnvironment('CRON_SKIP_AUTH', '1')
    .withEnvironment('COPILOT_WORKER_URL', workerUrl)
    .withEnvironment('COPILOT_WORKER_SECRET', workerSecret)
    .withEnvironment('OTEL_SERVICE_NAME', 'flight-school-web')
    .withEnvironment('NEXT_OTEL_FETCH_DISABLED', '1');

  await flightSchool.withCommand('sweep-retention', 'Run retention sweep', async (commandContext) => {
    const endpoint = await flightSchool.getEndpoint('http');
    const url = await endpoint.url();
    try {
      const res = await fetch(`${url}/api/cron/sweep`, { method: 'POST' });
      const body = await res.text();
      if (!res.ok) {
        return { success: false, errorMessage: `HTTP ${res.status}: ${body}` };
      }
      const commandLogger = await commandContext.logger.get();
      await commandLogger.logInformation(`Retention sweep complete: ${body}`);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  });

  await builder.build().run();
}

main().catch((error: unknown) => {
  console.error('AppHost failed:', error);
  process.exit(1);
});
