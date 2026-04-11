# Tasks: 20260411.01.mcp-oauth-managed-credentials

**Created**: 2026-04-11

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

---

## Task 1: Proto + Schema Foundation

**Status**: ✅ DONE
**Created**: 2026-04-11
**Completed**: 2026-04-11
**Repos**: stigmer (proto + Go), stigmer-cloud (Java)

The data layer that everything else builds on. All proto changes, stub regeneration, and storage schema updates.

### Subtasks

#### Proto (stigmer)
- [ ] Add `string org_id = 10` to `OAuthGrant` in `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto`
- [ ] Update OAuthGrant comments (replace "personal environment" references with "managed environment")
- [ ] Add `GetOAuthGrantStatusInput` message to `io.proto` (fields: `mcp_server_id`, `org`)
- [ ] Add `GetOAuthGrantStatusOutput` message to `io.proto` (fields: `connected`, `access_token_expires_at`, `target_env_var`, `auth_method`)
- [ ] Add `getOAuthGrantStatus` RPC to `query.proto`
- [ ] Run `make build` to regenerate all stubs (Go, Java, Python, TypeScript)

#### Go Grant Store (stigmer)
- [ ] Add `OrgID string` field to `OAuthGrant` struct in `grant_store.go`
- [ ] Change PRIMARY KEY to `(identity_account_id, mcp_server_id, org_id)` in SQLite table
- [ ] Add SQLite migration (ALTER TABLE to add `org_id` column, backfill empty string, recreate index)
- [ ] Update `Upsert` to include `org_id` in INSERT/UPDATE
- [ ] Update `GetByUserAndServer` to `GetByUserAndServerAndOrg` (three-part key)
- [ ] Update `DeleteByUserAndServer` to `DeleteByUserAndServerAndOrg`

#### Java Grant Document + Repo (stigmer-cloud)
- [ ] Add `orgId` field to `OAuthGrantDocument.java`
- [ ] Add `orgId` to upsert criteria in `OAuthGrantRepo.java` (line 44-47)
- [ ] Add `orgId` to all `set()` calls in upsert Update (line 49-60)
- [ ] Update `findByUserAndServer` → `findByUserAndServerAndOrg` (add orgId to query criteria)
- [ ] Update `deleteByUserAndServer` → `deleteByUserAndServerAndOrg`
- [ ] Add `orgId` to `documentToGrant` mapping
- [ ] Run `make protos` in stigmer-cloud to pick up new stubs

### Notes
- The `InitiateOAuthConnectInput` already has `org` (field 2). It flows to `PendingOAuthState` and then to `CompleteOAuthConnect`. The org value is available in the flow.

---

## Task 2: ManagedEnvironmentService + CompleteOAuthConnect

**Status**: ✅ DONE
**Created**: 2026-04-11
**Completed**: 2026-04-11
**Repos**: stigmer (Go), stigmer-cloud (Java)

Infrastructure services for managed environment operations + rewire the OAuth complete flow to use them.

### Subtasks

#### Go ManagedEnvironmentService (stigmer) — NEW FILE
- [ ] Create `backend/services/stigmer-server/pkg/domain/mcpserver/oauth/managed_env.go`
- [ ] `CreateManagedEnvironment(ctx, name, org, labels) → environmentID` — uses environment store directly, sets `stigmer.ai/managed=true` label
- [ ] `FindManagedEnvironment(ctx, identityAccountId, mcpServerId, org) → environmentID` — finds by grant's stored environment_id
- [ ] `ReadSecretValue(ctx, environmentID, key) → string` — reads decrypted secret from environment store
- [ ] `UpdateSecretVariables(ctx, environmentID, vars map[string]string) → error` — writes encrypted secrets

#### Java ManagedEnvironmentService (stigmer-cloud) — NEW FILE
- [ ] Create `ai.stigmer.domain.agentic.mcpserver.oauth.ManagedEnvironmentService` as Spring `@Service`
- [ ] Inject `EnvironmentRepo`, `SecretEncryptionService`
- [ ] `createManagedEnvironment(name, org, identityAccountId, labels) → environmentId` — creates Environment doc + FGA tuples (owner = identityAccountId). Mirrors `U20260411_SeedVendorOAuthApps` FGA pattern.
- [ ] `updateSecrets(environmentId, Map<String, String> vars)` — encrypts + writes via EnvironmentRepo
- [ ] `getSecretValue(environmentId, key) → String` — reads + decrypts via EnvironmentRepo
- [ ] Add class-level documentation explaining the boundary exception (direct repo access, analogous to OAuthAppRepo)

#### Mutation Guard — Go (stigmer)
- [ ] In environment update/delete handlers: check `metadata.labels["stigmer.ai/managed"]` == `"true"`, reject with `FAILED_PRECONDITION`

#### Mutation Guard — Java (stigmer-cloud)
- [ ] Create `RejectManagedEnvironmentMutation` pipeline step
- [ ] Add to `UpdateHandler`, `DeleteHandler`, `UpdateVariablesHandler`, `RemoveVariablesHandler` pipelines
- [ ] Reject with `FAILED_PRECONDITION: "environment is system-managed and cannot be modified directly"`

#### Rewire CompleteOAuthConnect — Go (stigmer)
- [ ] In `complete_oauth_connect.go`: replace `resolveOrCreatePersonalEnvironmentID` with managed env creation
- [ ] Set `grant.OrgID` from the org in pending state
- [ ] Use managed env service for token writes (not personal env)
- [ ] Environment name: `"OAuth: {mcpServerName}"`

#### Rewire CompleteOAuthConnect — Java (stigmer-cloud)
- [ ] In `McpServerCompleteOAuthConnectHandler.ExchangeAndStore`: replace `findOrCreatePersonalEnvironment` with `managedEnvironmentService.createManagedEnvironment(...)`
- [ ] Set `grant.setOrgId(org)` from pending state
- [ ] Use `managedEnvironmentService.updateSecrets(...)` for token writes
- [ ] Set `grant.setEnvironmentId(managedEnvId)`

### Notes
- The FGA tuple creation in `ManagedEnvironmentService` is critical. Without it, the managed environment is invisible to FGA-gated queries. Follow the pattern in `U20260411_SeedVendorOAuthApps.java`.
- The `EnvironmentCommandGrpcRepo` (OBO) is NOT used for managed envs — direct repo access with encryption is the pattern here.

---

## Task 3: Connect + Refresh + Session Injection

**Status**: ✅ DONE
**Created**: 2026-04-11
**Completed**: 2026-04-11
**Repos**: stigmer (Go), stigmer-cloud (Java)

Update all three consumption paths to read OAuth tokens from managed environments via `grant.environmentId`.

### Subtasks

#### Connect Handler — Go (stigmer)
- [ ] In `connect.go` `refreshOAuthTokenIfNeeded`: use `grant.EnvironmentID` directly instead of `resolveOrCreatePersonalEnvironmentID`
- [ ] In `createConnectExecutionContext`: when OAuth grant exists for a server, read its `target_env_var` from `grant.EnvironmentID`. Read remaining env vars from personal env. Merge.
- [ ] Update `resolveFromPersonalEnvironment` to skip OAuth-managed keys (those present in a grant)

#### Connect Handler — Java (stigmer-cloud)
- [ ] In `McpServerConnectHandler.RefreshOAuthToken`: pass through to `OAuthTokenRefreshService` (which will use grant.environmentId — see below)
- [ ] In `McpServerConnectHandler.ExecuteConnectWorkflow.resolveFromPersonalEnvironment`: when OAuth grant exists, read OAuth vars from `grant.environmentId` via `ManagedEnvironmentService.getSecretValue`. Remaining vars from personal env.

#### Refresh — Go (stigmer)
- [ ] In `refresh.go` `RefreshTokenIfExpired`: accept `environmentID` parameter from grant instead of re-resolving personal env
- [ ] Read refresh token from `grant.EnvironmentID` via managed env service
- [ ] Write refreshed tokens to `grant.EnvironmentID` via managed env service
- [ ] Update `connect.go` call site to pass `grant.EnvironmentID`

#### Refresh — Java (stigmer-cloud)
- [ ] In `OAuthTokenRefreshService.refreshIfExpired`: use `grant.getEnvironmentId()` directly
- [ ] Replace `findPersonalEnvironment` with `managedEnvironmentService.getSecretValue(grant.getEnvironmentId(), grant.getRefreshTokenEnvVar())`
- [ ] Write refreshed tokens via `managedEnvironmentService.updateSecrets(grant.getEnvironmentId(), tokenVars)`
- [ ] Remove dead `findPersonalEnvironment` method

#### Session Injection — Go (stigmer)
- [ ] In `create_execution_context_step.go`: add `injectMcpOAuthFromManagedEnvironment` function
- [ ] Needs access to `oauthGrantStore` + managed env read functions (inject via controller deps)
- [ ] For each MCP server referenced by the agent with `spec.auth`: look up grant by (user, server, org)
- [ ] If grant exists + missing var: check expiry, refresh inline if needed, read from `grant.EnvironmentID`
- [ ] Run AFTER `injectFromPersonalEnvironment`, BEFORE MCP validation
- [ ] NOTE: Go currently lacks `injectMcpEnvFromPersonalEnvironment` — this new function fills the OAuth gap

#### Session Injection — Java (stigmer-cloud)
- [ ] In `CreateExecutionContextStep.java`: add `injectMcpOAuthFromManagedEnvironment` method
- [ ] Inject `OAuthGrantRepo` and `ManagedEnvironmentService` into the step
- [ ] Run BEFORE existing `injectMcpEnvFromPersonalEnvironment` (line 189)
- [ ] For each MCP server on agent with `spec.auth`: look up grant by (user, server, org)
- [ ] If grant exists + target var missing: check expiry, refresh inline (via `OAuthTokenRefreshService`), read from `grant.environmentId`
- [ ] The existing `injectMcpEnvFromPersonalEnvironment` then handles remaining non-OAuth vars

### Notes
- Pre-flight refresh during session creation is important. Without it, a user who hasn't done a recent connect could start a session with an expired token. The connect pipeline has `RefreshOAuthToken` as a separate step, but the execution pipeline doesn't.
- Agent-runner (Python) needs zero changes — it reads from `ExecutionContext` regardless of variable source.

---

## Task 4: Frontend — OAuth Grant Status + Session Composer

**Status**: ⏸️ TODO
**Created**: 2026-04-11
**Repos**: stigmer (Go handlers + React SDK)

Backend query handlers and all frontend changes for OAuth status detection.

### Subtasks

#### getOAuthGrantStatus Handler — Go (stigmer)
- [ ] Implement handler in MCP server query controller
- [ ] Query grant store by (caller identity_account_id, mcp_server_id, org)
- [ ] Return `connected`, `access_token_expires_at`, `target_env_var`, `auth_method`

#### getOAuthGrantStatus Handler — Java (stigmer-cloud)
- [ ] Create `McpServerGetOAuthGrantStatusHandler`
- [ ] Query `OAuthGrantRepo.findByUserAndServerAndOrg`
- [ ] Return status fields from grant document

#### SDK TypeScript Client
- [ ] Add `getOAuthGrantStatus` to the `mcpServer` client namespace in the SDK wrapper (`sdk/typescript/`)

#### useOAuthGrantStatus Hook — NEW FILE
- [ ] Create `sdk/react/src/mcp-server/useOAuthGrantStatus.ts`
- [ ] Wraps `stigmer.mcpServer.getOAuthGrantStatus(mcpServerId, org)`
- [ ] Returns `{ connected, expiresAt, targetEnvVar, authMethod, isLoading, error, refetch }`
- [ ] Export from barrel `sdk/react/src/mcp-server/index.ts` and `sdk/react/src/index.ts`

#### useMcpServerCredentials Update
- [ ] Compose `useOAuthGrantStatus(mcpServer.metadata.id, org)`
- [ ] `isOAuthConnected` = `grantStatus.connected` (was: `existingKeys.has(oauthTargetEnvVar)`)
- [ ] `isReady` gates on `grantStatus.connected` (for OAuth var) AND `missingVariables.length === 0` (for manual vars)
- [ ] `isLoading` combines personal env loading + grant status loading

#### useMcpServerSetup Update
- [ ] In `addServer`: if `spec.auth` exists, call `stigmer.mcpServer.getOAuthGrantStatus(mcpServerId, org)` (imperative, inside async callback)
- [ ] If grant connected: add `oauthTargetEnvVar` to `existingKeys` before `diffEnvSpec`
- [ ] If grant NOT connected: leave in missingVariables, tag entry with `oauthStatus`
- [ ] Add `oauthStatus?: { connected: boolean; targetEnvVar: string }` to `McpServerSetupEntry` in `mcpServerSetupReducer.ts`
- [ ] Update pool re-evaluation effect to also consider grant status

#### UI Component Updates
- [ ] `McpServerDetailView.tsx` — `OAuthSection` uses grant status for connected/expired display (can show actual expiry)
- [ ] `McpServerPicker` — OAuth button rendering uses `oauthStatus` from entry state
- [ ] `McpServerConfigPanel` — Same

#### Environment List Filtering
- [ ] Filter environments with `stigmer.ai/managed=true` label from environment list views
- [ ] Ensure `usePersonalEnvironment` doesn't pick up managed envs

---

## Task 5: Migration + End-to-End Validation

**Status**: ⏸️ TODO
**Created**: 2026-04-11
**Repos**: stigmer + stigmer-cloud

Clean up existing data and validate all flows work together.

### Subtasks

#### Migration
- [ ] Wipe existing `oauth_grant` collection/table (pre-launch, no production data)
- [ ] Clean any OAuth tokens from personal environments that should now be in managed envs
- [ ] Verify SQLite schema migration works cleanly on fresh DB

#### End-to-End Validation
- [ ] OAuth connect: tokens stored in new managed env (not personal env)
- [ ] OAuthGrant has correct `org_id` and `environment_id` pointing to managed env
- [ ] Token refresh reads from `grant.environmentId` (check logs)
- [ ] MCP connect resolves OAuth vars from managed env + manual vars from personal env
- [ ] Session execution: `injectMcpOAuthFromManagedEnvironment` injects tokens correctly
- [ ] Frontend detail page: `isOAuthConnected` reflects grant status (not personal env)
- [ ] Frontend session composer: server auto-resolves to `ready` when grant exists
- [ ] Managed environment not visible in environment list UI
- [ ] Managed environment rejects user mutation attempts
- [ ] Personal environment contains only user-managed credentials

---

## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] OAuthGrant keyed by three-part key (identity, server, org)
- [ ] Managed environments created with `stigmer.ai/managed=true` label + FGA tuples
- [ ] All three flows (connect, refresh, session) use `grant.environmentId`
- [ ] Frontend uses `getOAuthGrantStatus` RPC for OAuth detection
- [ ] Mutation guard protects managed environments
- [ ] Personal environment is purely user-managed
- [ ] No regressions in existing non-OAuth MCP server flows
