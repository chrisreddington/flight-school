// =============================================================================
// Flight School cron job — periodic retention sweeper.
// =============================================================================
// Provisions an Azure Container Apps Job that fires on a schedule and calls
// `POST /api/cron/sweep` on the application's external ingress, authenticated
// with an AAD bearer token minted from a dedicated User-Assigned Managed
// Identity (UAMI).
//
// The route verifies the token against:
//   - `iss`  → Entra tenant
//   - `aud`  → CRON_AUDIENCE (this UAMI's `api://flight-school-cron` value)
//   - `appid` → UAMI client id (in CRON_ALLOWED_APPIDS)
//
// The same UAMI is also surfaced to the container app via env vars so the
// route handler can configure its JWKS verifier (`CRON_TENANT_ID`,
// `CRON_AUDIENCE`, `CRON_ALLOWED_APPIDS`). Those env wires live in
// `container-app.bicep`.
//
// NOTE: ACA Jobs cannot natively mint an AAD token at invocation time, so the
// container itself runs a tiny shell command that uses IMDS to obtain an
// access token for the configured audience and POSTs to the cron URL. The job
// image is the standard `mcr.microsoft.com/azure-cli` so we don't need to
// build a custom image just to run `curl + az`.
// =============================================================================

@description('Azure region.')
param location string

@description('Short app name; used to derive resource names.')
param appName string

@description('Resource tags.')
param tags object

@description('Resource ID of the Container Apps managed environment.')
param containerAppEnvironmentId string

@description('Fully qualified URL of the cron endpoint (e.g. https://flightschool.example.com/api/cron/sweep).')
param cronEndpointUrl string

@description('AAD audience the cron route expects. Recommended: api://<appName>-cron')
param cronAudience string

@description('Cron expression. Default = every 15 minutes.')
param schedule string = '*/15 * * * *'

@description('Replica timeout in seconds.')
param replicaTimeoutSeconds int = 600

var jobName = 'caj-${appName}-cron'

@description('Resource ID of the cron User-Assigned Managed Identity.')
param uamiResourceId string

@description('Client ID of the cron User-Assigned Managed Identity (used by IMDS at runtime).')
param uamiClientId string

resource cronJob 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uamiResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: 1
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: schedule
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
    template: {
      containers: [
        {
          name: 'cron-sweep'
          // azure-cli image already ships `curl` + IMDS-friendly tooling.
          image: 'mcr.microsoft.com/azure-cli:2.62.0'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'CRON_ENDPOINT', value: cronEndpointUrl }
            { name: 'CRON_AUDIENCE', value: cronAudience }
            { name: 'UAMI_CLIENT_ID', value: uamiClientId }
          ]
          // Mint a token from IMDS for the configured audience and POST it
          // to the cron endpoint. `--fail-with-body` returns non-zero on
          // any 4xx/5xx so ACA marks the replica as failed.
          command: ['/bin/sh', '-c']
          args: [
            'set -euo pipefail; TOKEN=$(az login --identity --username "$UAMI_CLIENT_ID" --allow-no-subscriptions > /dev/null && az account get-access-token --resource "$CRON_AUDIENCE" --query accessToken -o tsv); curl --fail-with-body -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --max-time 540 "$CRON_ENDPOINT"'
          ]
        }
      ]
    }
  }
}

output jobName string = cronJob.name
