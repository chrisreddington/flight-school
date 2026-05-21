// =============================================================================
// Cosmos DB (NoSQL API, serverless) for future server-side session/token store.
// =============================================================================

@description('Azure region.')
param location string

@description('Short app name; used to derive resource names.')
param appName string

@description('Resource tags.')
param tags object

@description('Cosmos database name.')
param databaseName string = 'flightschool'

@description('Container name used for the session/token store.')
param sessionsContainerName string = 'sessions'

var accountName = toLower('cosmos-${appName}-${uniqueString(resourceGroup().id)}')

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    minimalTlsVersion: 'Tls12'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource sessionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: sessionsContainerName
  properties: {
    resource: {
      id: sessionsContainerName
      partitionKey: {
        paths: [
          '/userId'
        ]
        kind: 'Hash'
      }
      defaultTtl: 2592000 // 30 days; sessions expire automatically.
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/"_etag"/?'
          }
        ]
      }
    }
  }
}

output accountName string = cosmosAccount.name
output accountId string = cosmosAccount.id
output databaseName string = database.name
output containerName string = sessionsContainer.name
output endpoint string = cosmosAccount.properties.documentEndpoint
@description('Primary connection string for the Cosmos account. Treat as a secret.')
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = cosmosAccount.listConnectionStrings().connectionStrings[0].connectionString
