// =============================================================================
// Flight School Container App
// =============================================================================
// - External ingress on port 3000, sticky sessions enabled.
// - System-assigned managed identity used to resolve Key Vault secret refs.
// - 1.0 vCPU / 2.0Gi memory to give the Copilot CLI subprocess headroom.
// - Min 1 replica (avoids cold starts for SSE), max 5 replicas.
// - Health probe wired to /api/health (endpoint to be added in a later phase).
// =============================================================================

@description('Azure region.')
param location string

@description('Short app name; used as the Container App name and DNS label.')
param appName string

@description('Resource tags.')
param tags object

@description('Container image tag (e.g. "sha-abc123" or "latest").')
param imageTag string

@description('Login server of the container registry holding the image.')
param acrLoginServer string

@description('Resource ID of the Container Apps managed environment.')
param containerAppEnvironmentId string

@description('Name of the Key Vault holding application secrets.')
param keyVaultName string

@description('URI of the Key Vault (e.g. https://kv-xxx.vault.azure.net/).')
param keyVaultUri string

@description('GitHub App client ID (informational; surfaced as env var for debug logs).')
param githubAppId string = ''

@description('Entra tenant id for cron JWT verification. Empty string disables cron auth (route will reject all calls).')
param cronTenantId string = ''

@description('Expected `aud` claim on cron-job AAD tokens (e.g. api://flightschool-cron).')
param cronAudience string = ''

@description('Comma-separated allowlist of caller appids (cron-job UAMI client id).')
param cronAllowedAppId string = ''

@description('Internal URL of the Copilot worker app. Empty string keeps in-process execution.')
param copilotWorkerUrl string = ''

var image = '${acrLoginServer}/${appName}:${imageTag}'

// Helper to build a Key Vault secret reference URI.
func kvSecretUri(vaultUri string, secretName string) string =>
  '${vaultUri}secrets/${secretName}'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        exposedPort: 0
        transport: 'auto'
        allowInsecure: false
        clientCertificateMode: 'ignore'
        stickySessions: {
          affinity: 'sticky'
        }
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      // Secrets sourced from Key Vault using the container app's
      // system-assigned managed identity. The "Key Vault Secrets User" role
      // assignment is created by key-vault-role-assignment.bicep.
      secrets: [
        {
          name: 'auth-secret'
          identity: 'system'
          keyVaultUrl: kvSecretUri(keyVaultUri, 'auth-secret')
        }
        {
          name: 'auth-github-id'
          identity: 'system'
          keyVaultUrl: kvSecretUri(keyVaultUri, 'auth-github-id')
        }
        {
          name: 'auth-github-secret'
          identity: 'system'
          keyVaultUrl: kvSecretUri(keyVaultUri, 'auth-github-secret')
        }
        {
          name: 'copilot-worker-secret'
          identity: 'system'
          keyVaultUrl: kvSecretUri(keyVaultUri, 'copilot-worker-secret')
        }
        {
          name: 'cosmos-conn-string'
          identity: 'system'
          keyVaultUrl: kvSecretUri(keyVaultUri, 'cosmos-conn-string')
        }
        {
          name: 'appinsights-connection-string'
          identity: 'system'
          keyVaultUrl: kvSecretUri(keyVaultUri, 'appinsights-connection-string')
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'ACA_DEPLOYMENT', value: 'true' }
            { name: 'AUTH_TRUST_HOST', value: 'true' }
            { name: 'PORT', value: '3000' }
            { name: 'GITHUB_APP_ID', value: githubAppId }
            { name: 'KEY_VAULT_NAME', value: keyVaultName }
            { name: 'CRON_TENANT_ID', value: cronTenantId }
            { name: 'CRON_AUDIENCE', value: cronAudience }
            { name: 'CRON_ALLOWED_APPIDS', value: cronAllowedAppId }
            { name: 'COPILOT_WORKER_URL', value: copilotWorkerUrl }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'AUTH_GITHUB_ID', secretRef: 'auth-github-id' }
            { name: 'AUTH_GITHUB_SECRET', secretRef: 'auth-github-secret' }
            { name: 'COPILOT_WORKER_SECRET', secretRef: 'copilot-worker-secret' }
            { name: 'COSMOS_CONNECTION_STRING', secretRef: 'cosmos-conn-string' }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'appinsights-connection-string'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 30
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: {
                path: '/api/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output name string = containerApp.name
output fqdn string = containerApp.properties.configuration.ingress.fqdn
@description('Principal ID of the system-assigned managed identity (used for KV RBAC).')
output principalId string = containerApp.identity.principalId
