// =============================================================================
// Key Vault with RBAC authorization.
// =============================================================================
// Seeds two operational secrets we can compute at deploy time:
//   - cosmos-conn-string
//   - appinsights-connection-string
//
// The following secrets MUST be populated manually BEFORE the Container App
// will start successfully (see infra/README.md):
//   - auth-secret               (Auth.js JWT encryption key; `openssl rand -base64 32`)
//   - auth-github-id            (GitHub App client ID)
//   - auth-github-secret        (GitHub App client secret)
//   - copilot-worker-secret     (web-to-worker bearer secret; `openssl rand -base64 32`)
// =============================================================================

@description('Azure region.')
param location string

@description('Short app name; used to derive the Key Vault name.')
param appName string

@description('Resource tags.')
param tags object

@description('Cosmos DB connection string to seed into Key Vault.')
@secure()
param cosmosConnectionString string

@description('Application Insights connection string to seed into Key Vault.')
@secure()
param appInsightsConnectionString string

var keyVaultName = toLower('kv-${appName}-${uniqueString(resourceGroup().id)}')

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// Seed deploy-time operational secrets. Auth secrets are populated out-of-band.
resource cosmosSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cosmos-conn-string'
  properties: {
    value: cosmosConnectionString
  }
}

resource appInsightsSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'appinsights-connection-string'
  properties: {
    value: appInsightsConnectionString
  }
}

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultId string = keyVault.id
