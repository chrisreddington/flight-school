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
