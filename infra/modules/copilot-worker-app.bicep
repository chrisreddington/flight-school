// =============================================================================
// Flight School Copilot Worker Container App
// =============================================================================
// - Internal ingress only on port 3001.
// - Distinct image (`${appName}-worker:${imageTag}`) built from
//   `Dockerfile.worker`; the worker is a standalone Hono/Node process, not
//   the Next.js web image.
// - System-assigned managed identity used to resolve Key Vault secret refs.
// =============================================================================

@description('Azure region.')
param location string

@description('Short app name; used as the base Container App name and DNS label.')
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

var workerName = '${appName}-worker'
var image = '${acrLoginServer}/${appName}-worker:${imageTag}'

func kvSecretUri(vaultUri string, secretName string) string =>
  '${vaultUri}secrets/${secretName}'

resource workerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: workerName
  location: location
  tags: union(tags, {
    role: 'copilot-worker'
  })
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 3001
        exposedPort: 0
        transport: 'http'
        allowInsecure: false
        clientCertificateMode: 'ignore'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
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
          name: 'copilot-worker'
          image: image
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'ACA_DEPLOYMENT', value: 'true' }
            { name: 'AUTH_TRUST_HOST', value: 'true' }
            { name: 'PORT', value: '3001' }
            { name: 'KEY_VAULT_NAME', value: keyVaultName }
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
                port: 3001
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
                port: 3001
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
                port: 3001
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
        maxReplicas: 3
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
}

output name string = workerApp.name
output fqdn string = workerApp.properties.configuration.ingress.fqdn
@description('Principal ID of the system-assigned managed identity (used for KV RBAC).')
output principalId string = workerApp.identity.principalId
