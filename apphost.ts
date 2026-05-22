// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev

import { createBuilder } from './.modules/aspire.js';

async function main(): Promise<void> {
  const builder = await createBuilder();

  const acaEnv = await builder.addAzureContainerAppEnvironment('aca-env');
  await acaEnv.withAzdResourceNaming();

  await builder
    .addNextJsApp('flight-school', '.', { runScriptName: 'dev' })
    .withHttpEndpoint({ port: 3000, targetPort: 3000, isProxied: false })
    .withExternalHttpEndpoints();

  await builder.build().run();
}

main().catch((error: unknown) => {
  console.error('AppHost failed:', error);
  process.exit(1);
});
