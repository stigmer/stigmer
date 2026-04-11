# Next Task: 20260411.01.mcp-oauth-managed-credentials

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260411.01.mcp-oauth-managed-credentials

**Description**: Separate OAuth token storage from personal environments into per-(user, org, resource) managed environments with strict mutation protection. Generalized OAuthGrant to be resource-agnostic (keyed by identity_account_id, resource_id, org_id). Use grant.environmentId as the authoritative token locator across connect, refresh, and session execution flows.
**Goal**: Clean separation of system-managed OAuth credentials from user-managed personal environments, eliminating collision risk and mixed concerns.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-11
**Status**: T01 DONE, T02 DONE, T03 NEXT
**Active Task**: T03 — Connect + Refresh + Session Injection
**Last Session**: 2026-04-11 (T02 completed — ManagedEnvironmentService + CompleteOAuthConnect rewiring)

## Session Progress (2026-04-11, Session 2)

### T02 Completed: ManagedEnvironmentService + CompleteOAuthConnect Rewiring

**Design decisions**:
- **Downstream layer for all managed env operations**: Both Go and Java managed env services call through the established downstream gRPC layer (`environment.Client` in Go, `EnvironmentCommandGrpcRepo`/`EnvironmentQueryGrpcRepo` in Java). No direct repo access. This gives encryption, FGA tuples, validation, and audit automatically.
- **No backend mutation guard**: Deferred to frontend-only (T04 will filter managed environments from environment list, hide edit/delete options). No harm since managed environments are system-created and not surfaced in the UI.
- **Re-connect reuse**: On re-connect (same user + server + org already has a grant with an environment ID), the existing managed environment is reused — only its secrets are updated with fresh tokens. Prevents orphaned environments.
- **Dropped `FindManagedEnvironment`**: Callers use `grant.EnvironmentID` directly — it's the authoritative token locator as stated in the project description.

**Changes made (stigmer):**
- **NEW `managed_env.go`**: `ManagedEnvironmentService` in `pkg/domain/mcpserver/oauth/` — thin service over `environment.Client` with `CreateManagedEnvironment`, `UpdateSecrets`, `ReadSecretValue` methods. Creates environments with `stigmer.ai/managed=true` label.
- **`mcpserver_controller.go`**: Added `managedEnvService` field, initialized in `SetConnectDependencies()`.
- **`complete_oauth_connect.go`**: Rewired `CompleteOAuthConnect` to use managed environment instead of personal. New `resolveOrCreateManagedEnvironment` method handles re-connect reuse (checks existing grant for environment ID). `resolveOrCreatePersonalEnvironmentID` preserved for `refreshOAuthTokenIfNeeded` in connect.go (T03 scope).

**Changes made (stigmer-cloud):**
- **NEW `ManagedEnvironmentService.java`**: Spring `@Service` in `domain/agentic/mcpserver/oauth/` — backed by `EnvironmentCommandGrpcRepo` + `EnvironmentQueryGrpcRepo`. FGA tuples created automatically via standard create pipeline (owner = identityAccountId).
- **`McpServerCompleteOAuthConnectHandler.java`**: Rewired `ExchangeAndStore` step — replaced `EnvironmentCommandGrpcRepo`/`EnvironmentQueryGrpcRepo` with `ManagedEnvironmentService` + `McpServerRepo`. New `resolveOrCreateManagedEnvironment` private method with re-connect reuse logic. Removed dead `findOrCreatePersonalEnvironment` method and `PERSONAL_ENV_LABEL` constant.

**Verification:**
- Go: `go build ./...` passes
- Java: `bazel build //backend/services/stigmer-service/...` passes (36 targets)

### T01 Completed: Proto + Schema Foundation

**Design decision**: Generalized OAuthGrant from MCP-specific to resource-agnostic. Renamed `mcp_server_id` to `resource_id`, added `resource_kind` and `org_id`. This was a deliberate design choice — the OAuthGrant data model can now support any API resource kind (workflows, etc.) without migration when the second consumer arrives.

**Changes made:**
- **oauth.proto**: Renamed `mcp_server_id` → `resource_id` (field 2), added `resource_kind` (field 10), `org_id` (field 11). Updated all comments for managed env + resource-agnostic language.
- **io.proto**: Added `GetOAuthGrantStatusInput` (uses `resource_id` + `org`) and `GetOAuthGrantStatusOutput` (connected, expires_at, target_env_var, auth_method).
- **command.proto**: Added `getOAuthGrantStatus` RPC on `McpServerCommandController` with `can_view` permission.
- **grant_store.go** (Go): Struct renamed `McpServerID` → `ResourceID`, added `ResourceKind`, `OrgID`. PK now `(identity_account_id, resource_id, org_id)`. Methods renamed to `Find`/`Delete` with three-part key.
- **refresh.go** (Go): Updated all `grant.McpServerID` references to `grant.ResourceID`.
- **complete_oauth_connect.go** (Go): Grant construction sets `ResourceID`, `ResourceKind = "mcp_server"`, `OrgID`.
- **connect.go** (Go): Uses `oauthGrantStore.Find(ctx, "", mcpServerID, org)`.
- **OAuthGrantDocument.java**: `mcpServerId` → `resourceId`, added `resourceKind`, `orgId`.
- **OAuthGrantRepo.java**: Full rewrite — three-part key queries, `find`/`delete` methods.
- **McpServerCompleteOAuthConnectHandler.java**: Grant construction sets `resourceId`, `resourceKind`, `orgId`.
- **OAuthTokenRefreshService.java**: Uses `grantRepo.find(identityAccountId, mcpServerId, org)`.
- **Stubs regenerated**: `make codegen` (stigmer), `make protos` (stigmer-cloud). Both repos compile cleanly.

## Next Steps

1. **T03: Connect + Refresh + Session Injection** — Update all three consumption paths to read OAuth tokens from managed environments via `grant.environmentId`. This is where `resolveOrCreatePersonalEnvironmentID` and `findPersonalEnvironment` in the refresh/connect flows get replaced.
2. **T04: Frontend** — Backend query handlers + React hooks + UI component updates. Filter managed environments from environment list. Hide edit/delete for managed envs.
3. **T05: Migration + End-to-End Validation** — Clean up existing data and validate all flows.

## Context for Resume

- The `getOAuthGrantStatus` RPC is proto-defined but not yet implemented (handler implementation is T04).
- The `PendingOAuthState` (Go + Java) was NOT renamed — it's MCP-specific by design and stays with `McpServerID`.
- Go OSS mode uses empty string `""` for `identity_account_id` — this pattern continues.
- **CompleteOAuthConnect now writes to managed environments** (T02). But refresh and connect still read from personal environments (T03 will fix this).
- `resolveOrCreatePersonalEnvironmentID` still exists in Go `complete_oauth_connect.go` — used by `refreshOAuthTokenIfNeeded` in `connect.go`. T03 will replace it.
- `findPersonalEnvironment` still exists in Java `OAuthTokenRefreshService` — T03 scope.
- The managed environment name is `"OAuth: {mcpServerName}"`.
- The managed environment label is `stigmer.ai/managed=true`.
- Re-connect reuse: existing grant's `environmentId` is reused if present.

## Key Design Decisions Made

1. **`resource_id` instead of `mcp_server_id`**: OAuthGrant is now resource-agnostic. The code still lives in `mcpserver/oauth/` — move to shared location when second consumer arrives.
2. **`resource_kind` field added**: For query filtering and handler routing. Not part of the primary key.
3. **`resource_id` instead of `ApiResourceReference`**: Discussed using slug-based references but chose system IDs — all consumption paths have the ID at hand, slugs could be renamed, and the grant is an infrastructure record (not a user-facing YAML resource).
4. **`getOAuthGrantStatusInput` uses `resource_id`**: Generic, matching the grant model. The MCP-specific RPCs (initiate/complete) keep `mcp_server_id`.
5. **Downstream layer for managed env operations**: No direct repo access. Uses existing gRPC downstream layer for encryption, FGA, validation, audit.
6. **No backend mutation guard**: Frontend-only protection. No harm in skipping backend guard — managed environments are system-created, not user-visible.
7. **Re-connect reuse**: Existing managed environment reused on re-connect rather than creating new + orphaning old.

## Key References

- **Predecessor project**: `_projects/2026-04/20260410.03.mcp-oauth-connect/next-task.md`
- **Task list**: `_projects/2026-04/20260411.01.mcp-oauth-managed-credentials/tasks.md`
- **Architect role**: `_roles/001_architect.md`
- **Plan file (T01)**: `.cursor/plans/t01_proto_schema_foundation_e74bbe93.plan.md`
- **Plan file (T02)**: `.cursor/plans/t02_managedenv_service_b1fd0b7a.plan.md`

---

*Drop this file into a new conversation to resume work on this project.*
