# Flight School — Azure Container Apps infrastructure

> [!WARNING]
> **Exploratory only — not production guidance.**
> These Bicep modules are for experimenting with Flight School on Azure Container Apps while evaluating GitHub, Copilot SDK, Aspire, and related platform capabilities.
> This project is **not recommended for production use**.

This directory contains the Bicep modules that provision a multi-tenant
reference environment for Flight School on **Azure Container Apps (ACA)**.

## What gets deployed

| Resource | Purpose |
| --- | --- |
| Resource group `rg-<appName>` | Container for everything below |
| Log Analytics workspace `log-<appName>` | ACA logs sink |
| Application Insights `appi-<appName>` | App telemetry; conn string seeded into Key Vault |
| Container Apps managed environment `cae-<appName>` | Consumption workload profile |
| Cosmos DB (NoSQL, **serverless**) | DB `flightschool`, container `sessions` (partition key `/userId`, 30-day TTL) for future server-side session/token store |
| Key Vault `kv-<appName>-<hash>` | RBAC-enabled; holds Auth.js, GitHub App, Cosmos, and App Insights secrets |
| Container App `<appName>` | The Next.js + Copilot CLI workload (1 vCPU / 2 GiB, 1–5 replicas) — pulls image `<acrLoginServer>/<appName>:<imageTag>` (built from `Dockerfile`) |
| Container App `<appName>-worker` | Private internal Copilot worker (1 vCPU / 2 GiB, **single replica**) — pulls image `<acrLoginServer>/<appName>-worker:<imageTag>` (built from `Dockerfile.worker`) |

The Container App runs with a **system-assigned managed identity** that is
granted the **Key Vault Secrets User** role on the Key Vault so it can resolve
secret references at runtime.

## Architecture notes

- **Ingress** is external on target port 3000, transport `auto`, with
  `stickySessions.affinity: 'sticky'` so an SSE stream from the Copilot CLI
  subprocess stays pinned to the replica that owns it. `clientCertificateMode`
  is `ignore`.
- **Idle / request timeout.** ACA's HTTP edge currently caps a single request
  at **~240 s** (4 minutes). That's fine for short Copilot turns but a long
  agentic run that streams for longer than 4 minutes will be cut by the edge
  even though the underlying SSE channel is still healthy. There is currently
  **no public Bicep property** to raise this on Consumption — track this as a
  known limitation and mitigate at the app layer (heartbeats / resume tokens /
  reconnect). If/when Microsoft surfaces a configurable idle timeout on
  `ingress`, set it here.
- **Sizing.** 1 vCPU / 2 GiB per replica gives the Copilot CLI Node subprocess
  enough headroom; bump if you see OOMs in App Insights.
- **Min replicas = 1** to avoid cold-start latency on the first SSE byte. Max 5
  with an HTTP concurrency scaler at 50 concurrent requests/replica.
- **Cosmos = serverless** to keep idle cost near zero until P9 turns on the
  server-side session store. Partition key `/userId`, 30-day TTL.
- **Health probes** all hit `/api/health`. That endpoint is owned by another
  phase; until it exists the startup probe will keep retrying for ~2.5 minutes
  before failing the revision.

## Prerequisites

1. **Azure CLI** (`az --version` ≥ 2.60) with the `bicep` extension.
2. An Azure subscription you can deploy into; you need `Owner` or
   `Contributor` **plus** `User Access Administrator` (the deployment creates
   a role assignment on the Key Vault).
3. **Two** container images pushed to a registry the Container Apps can pull from
   (GHCR, ACR, etc.). The full image references used at runtime are:
   - **Web:** `${acrLoginServer}/${appName}:${imageTag}` — built from
     `Dockerfile` at the repo root.
   - **Worker:** `${acrLoginServer}/${appName}-worker:${imageTag}` — built
     from `Dockerfile.worker`. Both images must be pushed with the **same**
     `imageTag` for a given deployment; the Bicep template wires both
     Container Apps to that tag. There is no CI workflow that builds the
     worker image yet — see [`docs/deployment-aca.md`](../docs/deployment-aca.md)
     for the manual `docker build` / push commands.
4. A **GitHub App** (not OAuth App) — see the next section.

## GitHub App setup

Auth.js v5 expects the GitHub OAuth callback at the path
`/api/auth/callback/github`. The ACA default hostname is
`https://<appName>.<region>.azurecontainerapps.io` (the exact FQDN is
emitted as the `containerAppFqdn` deployment output, since ACA may suffix the
hostname with a hash on collision).

1. Create a GitHub App: <https://github.com/settings/apps/new>.
2. **Homepage URL:** `https://<appName>.<region>.azurecontainerapps.io`
3. **Callback URL:** `https://<appName>.<region>.azurecontainerapps.io/api/auth/callback/github`
4. Enable **"Request user authorization (OAuth) during installation"**.
5. Generate a **client secret** and note both the **Client ID** and the secret.
6. Set the scopes / permissions your app needs (at minimum: read access to
   user profile and any repos the in-app features touch).

If you don't yet know the final FQDN, deploy once with placeholder secrets,
read `containerAppFqdn` from the outputs, then update the GitHub App callback
URL.

## First-time deployment

### 1. Fill in parameters

Copy and edit:

```bash
cp infra/main.parameters.json infra/main.parameters.local.json
$EDITOR infra/main.parameters.local.json
```

Set `acrLoginServer` (e.g. `ghcr.io/your-org`), `appName`, `location`,
`imageTag`, and `githubAppId`.

### 2. Deploy the infrastructure

The template targets **subscription scope** and creates the resource group for
you.

```bash
az login
az account set --subscription "<your-subscription-id>"

az deployment sub create \
  --name flightschool-$(date +%Y%m%d-%H%M%S) \
  --location uksouth \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.local.json
```

The first deploy will **succeed at the ARM level even though the Container App
revision will fail to start** — that's expected, because the three auth
secrets aren't in Key Vault yet. Populate them next.

### 3. Populate Key Vault secrets

Grab the Key Vault name from the deployment output:

```bash
KV=$(az deployment sub show \
  --name <deployment-name> \
  --query properties.outputs.keyVaultName.value -o tsv)
```

Grant **yourself** the `Key Vault Secrets Officer` role temporarily so you can
write the secrets (RBAC mode — vault access policies are off):

```bash
ME=$(az ad signed-in-user show --query id -o tsv)
KV_ID=$(az keyvault show --name "$KV" --query id -o tsv)
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee-object-id "$ME" \
  --assignee-principal-type User \
  --scope "$KV_ID"
```

Then set the four required secrets:

```bash
# Auth.js JWT encryption key — 32 random bytes, base64-encoded.
az keyvault secret set --vault-name "$KV" \
  --name auth-secret --value "$(openssl rand -base64 32)"

# GitHub App client ID.
az keyvault secret set --vault-name "$KV" \
  --name auth-github-id --value "<github-app-client-id>"

# GitHub App client secret.
az keyvault secret set --vault-name "$KV" \
  --name auth-github-secret --value "<github-app-client-secret>"

# Web-to-worker bearer secret.
az keyvault secret set --vault-name "$KV" \
  --name copilot-worker-secret --value "$(openssl rand -base64 32)"
```

`cosmos-conn-string` and `appinsights-connection-string` are seeded
automatically by the Bicep template.

### 4. Restart the Container App revision

ACA polls Key Vault secret refs on revision start. To pick up the new secrets,
either deploy a new revision (re-run the `az deployment sub create` above) or
force a restart:

```bash
RG=$(az deployment sub show --name <deployment-name> \
       --query properties.outputs.resourceGroupName.value -o tsv)
APP=$(az deployment sub show --name <deployment-name> \
       --query 'properties.parameters.appName.value' -o tsv)

# Restart the latest revision.
REV=$(az containerapp revision list -g "$RG" -n "$APP" \
        --query "[?properties.active].name | [0]" -o tsv)
az containerapp revision restart -g "$RG" -n "$APP" --revision "$REV"
```

### 5. Hit the app

```bash
az deployment sub show --name <deployment-name> \
  --query properties.outputs.containerAppUrl.value -o tsv
```

Sign in via GitHub. If the callback URL on the GitHub App was a placeholder,
update it now to the real FQDN.

## Redeploying with a new image tag

```bash
az deployment sub create \
  --name flightschool-$(date +%Y%m%d-%H%M%S) \
  --location uksouth \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.local.json \
  --parameters imageTag=sha-abc1234
```

This creates a new ACA revision with the new image; traffic shifts to it
once it passes the readiness probe (single-revision mode, 100% traffic).

## Rotating secrets

1. `az keyvault secret set ...` to write the new value (a new version is
   created automatically).
2. Restart the active revision (see step 4 above) so ACA re-resolves the
   secret reference.

## Cleaning up

```bash
RG=rg-flightschool
az group delete --name "$RG" --yes --no-wait
# Key Vault has purge protection ON and a 7-day soft-delete window — if you
# want to fully purge it before then:
az keyvault purge --name "$KV"
```

## Validation

```bash
az bicep build --file infra/main.bicep --stdout >/dev/null
```

This was the only validation performed — **no resources were actually
deployed to Azure** as part of authoring this template.

## Known limitations / open questions

- **Ingress idle timeout.** No public `ingress` property to raise above the
  default ~240 s on Consumption profile. App-layer mitigation required for
  long-running SSE streams.
- **Region default.** Defaults to `uksouth`; pick the region nearest your
  users. Cosmos serverless and ACA are GA in all major regions but double-
  check pricing/availability if you change it.
- **Copilot worker scaffold.** The template now deploys `<appName>-worker` with
  internal ingress and injects its internal URL into the public web app via
  `COPILOT_WORKER_URL`. Background jobs still run through the in-process
  dispatcher; Service Bus/KEDA worker consumers remain future work.
- **Registry auth.** This template assumes a **public** registry, or that the
  Container Apps environment has been pre-wired with registry credentials. For
  private ACR with managed-identity pull, add a `registries` block in
  `container-app.bicep` and grant `AcrPull` on the ACR — out of scope for P8.
- **Cosmos `disableLocalAuth: false`.** Kept on for the bootstrap flow where
  we hand the connection string to the app. P9 should flip this to
  managed-identity auth and remove `cosmos-conn-string` from Key Vault.
- **Custom domain / TLS.** Not configured. Add `customDomains` to
  `container-app.bicep` and a managed cert once you have a domain.
