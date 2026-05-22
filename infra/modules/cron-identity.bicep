// =============================================================================
// User-Assigned Managed Identity for the cron retention sweeper job.
// =============================================================================
// Lives in its own module so both `container-app.bicep` (which needs the
// `clientId` for CRON_ALLOWED_APPIDS) and `cron-job.bicep` (which needs the
// resource id to attach the identity) can depend on it without forming a
// dependency cycle.
// =============================================================================

@description('Azure region.')
param location string

@description('Short app name; used to derive the identity name.')
param appName string

@description('Resource tags.')
param tags object

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${appName}-cron'
  location: location
  tags: tags
}

output clientId string = uami.properties.clientId
output resourceId string = uami.id
output principalId string = uami.properties.principalId
