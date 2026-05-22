// =============================================================================
// Flight School - Azure Container Apps deployment (subscription scope)
// =============================================================================
// Top-level orchestrator. Creates a resource group and wires up:
//   - Log Analytics + Container Apps environment
//   - Application Insights
//   - Key Vault (with RBAC for the app's managed identity)
//   - Cosmos DB (serverless) for future session/token store
//   - The Container App itself
//
// NOTE: Key Vault secrets (auth-secret, auth-github-id, auth-github-secret) MUST
// be populated manually BEFORE the Container App will start successfully. See
// infra/README.md for `az keyvault secret set` commands.
// =============================================================================

targetScope = 'subscription'

@description('Azure region for all resources.')
param location string = 'uksouth'

@description('Short app name; used as the basis for resource names and the Container App ingress hostname.')
@minLength(3)
@maxLength(20)
param appName string = 'flightschool'

@description('Container image tag to deploy (e.g. "sha-abc123" or "latest").')
param imageTag string = 'latest'

@description('Login server of the container registry that holds the image (e.g. "ghcr.io/owner" or "myacr.azurecr.io").')
param acrLoginServer string

@description('GitHub App client ID (informational; the actual secret value is stored in Key Vault as "auth-github-id").')
param githubAppId string = ''

@description('Resource group name. Defaults to "rg-<appName>".')
param resourceGroupName string = 'rg-${appName}'

@description('Environment tag for cost/ownership tracking.')
param environment string = 'prod'

@description('Entra tenant ID. Required for cron-job JWT verification. Defaults to the tenant of the deployment principal.')
param tenantId string = subscription().tenantId

@description('Cron schedule expression for the retention sweeper job. Default = every 15 minutes.')
param cronSchedule string = '*/15 * * * *'

@description('Public hostname the cron Job should call (e.g. flightschool.example.com). If empty, falls back to the container app FQDN minted during deployment.')
param cronHostname string = ''

var tags = {
  app: appName
  environment: environment
  managedBy: 'bicep'
  workload: 'flight-school'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module appInsights 'modules/app-insights.bicep' = {
  scope: rg
  name: 'app-insights'
  params: {
    location: location
    appName: appName
    tags: tags
  }
}

module env 'modules/container-app-env.bicep' = {
  scope: rg
  name: 'container-app-env'
  params: {
    location: location
    appName: appName
    tags: tags
  }
}

module cosmos 'modules/cosmos.bicep' = {
  scope: rg
  name: 'cosmos'
  params: {
    location: location
    appName: appName
    tags: tags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  scope: rg
  name: 'key-vault'
  params: {
    location: location
    appName: appName
    tags: tags
    // Seed the KV with operational secrets that we can compute now.
    cosmosConnectionString: cosmos.outputs.connectionString
    appInsightsConnectionString: appInsights.outputs.connectionString
  }
}

module cronIdentity 'modules/cron-identity.bicep' = {
  scope: rg
  name: 'cron-identity'
  params: {
    location: location
    appName: appName
    tags: tags
  }
}

module containerApp 'modules/container-app.bicep' = {
  scope: rg
  name: 'container-app'
  params: {
    location: location
    appName: appName
    tags: tags
    imageTag: imageTag
    acrLoginServer: acrLoginServer
    containerAppEnvironmentId: env.outputs.environmentId
    keyVaultName: keyVault.outputs.keyVaultName
    keyVaultUri: keyVault.outputs.keyVaultUri
    githubAppId: githubAppId
    cronTenantId: tenantId
    cronAudience: 'api://${appName}-cron'
    cronAllowedAppId: cronIdentity.outputs.clientId
  }
}

var resolvedCronHostname = empty(cronHostname) ? containerApp.outputs.fqdn : cronHostname

module cronJob 'modules/cron-job.bicep' = {
  scope: rg
  name: 'cron-job'
  params: {
    location: location
    appName: appName
    tags: tags
    containerAppEnvironmentId: env.outputs.environmentId
    cronEndpointUrl: 'https://${resolvedCronHostname}/api/cron/sweep'
    cronAudience: 'api://${appName}-cron'
    schedule: cronSchedule
    uamiResourceId: cronIdentity.outputs.resourceId
    uamiClientId: cronIdentity.outputs.clientId
  }
}

// Grant the container app's system-assigned managed identity access to KV
// secrets. Separated to break the principalId / keyVault dependency cycle.
module keyVaultRoleAssignment 'modules/key-vault-role-assignment.bicep' = {
  scope: rg
  name: 'key-vault-role-assignment'
  params: {
    keyVaultName: keyVault.outputs.keyVaultName
    principalId: containerApp.outputs.principalId
  }
}

output containerAppFqdn string = containerApp.outputs.fqdn
output containerAppUrl string = 'https://${containerApp.outputs.fqdn}'
output keyVaultName string = keyVault.outputs.keyVaultName
output cosmosAccountName string = cosmos.outputs.accountName
output appInsightsName string = appInsights.outputs.name
output resourceGroupName string = rg.name
output cronJobName string = cronJob.outputs.jobName
output cronUamiClientId string = cronIdentity.outputs.clientId
