// =============================================================================
// Grants the Container App's system-assigned managed identity the
// "Key Vault Secrets User" role on the Key Vault so it can resolve
// secret references at runtime.
// =============================================================================

@description('Name of an existing Key Vault in the current resource group.')
param keyVaultName string

@description('Principal ID of the Container App system-assigned managed identity.')
param principalId string

// Built-in role: Key Vault Secrets User
// https://learn.microsoft.com/azure/role-based-access-control/built-in-roles#key-vault-secrets-user
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, principalId, keyVaultSecretsUserRoleId)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}
