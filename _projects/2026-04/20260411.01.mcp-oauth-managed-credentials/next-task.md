# Next Task: 20260411.01.mcp-oauth-managed-credentials

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260411.01.mcp-oauth-managed-credentials

**Description**: Separate OAuth token storage from personal environments into per-(user, org, resource) managed environments with strict mutation protection. Generalized OAuthGrant to be resource-agnostic (keyed by identity_account_id, resource_id, org_id). Use grant.environmentId as the authoritative token locator across connect, refresh, and session execution flows.
**Goal**: Clean separation of system-managed OAuth credentials from user-managed personal environments, eliminating collision risk and mixed concerns.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-11
**Status**: T01 DONE, T02 DONE, T03 DONE, T04 NEXT
**Active Task**: T04 — Frontend (OAuth Grant Status + Session Composer)
**Last Session**: 2026-04-11 (T03 completed — Connect + Refresh + Session Injection via managed environments)

## Session Progress (2026-04-11, Session 3)

### T03 Completed: Connect + Refresh + Session Injection

All three OAuth token consumption paths now read/write from managed environments via `grant.environmentId`. Personal environments are exclusively for user-managed credentials.

**Design decisions**:
- **`resolveFromPersonalEnvironment` stays domain-neutral**: Rather than injecting OAuth awareness into the general-purpose personal-env resolver, the connect handler splits resolution: OAuth vars from managed env first, then remaining declarations to personal env. The two maps are merged at the caller.
- **Inline refresh during session injection**: Both Go and Java execution context steps perform pre-flight token refresh inline (non-fatal). Go uses the pure `oauth.RefreshTokenIfExpired` function directly; Java calls `OAuthTokenRefreshService.refreshIfExpired`. No client_secret resolution in the Go inline path (DCR/public clients only — vendor OAuth uses the connect pre-flight).
- **Cross-domain read accepted**: `AgentExecutionController` reads from `OAuthGrantStore` (MCP domain). Mirrors the existing Java pattern where `McpEnvironmentValidator` reads from `McpServerRepo`. The grant store is resource-agnostic (T01 decision).
- **Guard for empty `EnvironmentID`**: All paths check `grant.EnvironmentID != ""` before attempting managed env reads. Grants created before T02 (if any) are gracefully skipped with a warning log.

**Changes made (stigmer — Go, 7 files, +314 -67):**
- **`connect.go`**: `refreshOAuthTokenIfNeeded` rewired to read/write via `managedEnvService` instead of personal env. New `resolveOAuthVarsFromManagedEnv` function splits OAuth vs personal env resolution in `createConnectExecutionContext`.
- **`complete_oauth_connect.go`**: Deleted `resolveOrCreatePersonalEnvironmentID` (no callers). Removed unused `apiresource` import.
- **`refresh.go`**: Updated docstring comments (personal env → managed environment).
- **`create_execution_context_step.go`**: New `injectMcpOAuthFromManagedEnvironment` method + `inlineRefreshIfExpired` helper. Added `oauthGrantStore`, `managedEnvService`, `store` to step struct. Uses `steps.FindResourceBySlug` to load MCP servers from agent's `mcp_server_usages`.
- **`agentexecution_controller.go`**: Added `oauthGrantStore` + `managedEnvService` fields and `SetOAuthDependencies` setter.
- **`server.go`**: Wires `managedEnvService` + `oauthGrantStore` into `AgentExecutionController.SetOAuthDependencies`.
- **`spec.proto`**: Updated `McpServerAuth` and `McpServerSpec.auth` comments — "personal environment" → "system-managed environment" / "grant's managed environment".

**Changes made (stigmer-cloud — Java, 2 files, +213 -18):**
- **`OAuthTokenRefreshService.java`**: Replaced `EnvironmentQueryGrpcRepo`/`EnvironmentCommandGrpcRepo` with `ManagedEnvironmentService`. Deleted `findPersonalEnvironment`, `PERSONAL_ENV_LABEL`. All token reads/writes go through `grant.getEnvironmentId()`.
- **`McpServerConnectHandler.java`**: Added `OAuthGrantRepo` + `ManagedEnvironmentService` to `ExecuteConnectWorkflow` step. New `resolveOAuthVarsFromManagedEnv` private method for split resolution.
- **`CreateExecutionContextStep.java`**: New `injectMcpOAuthFromManagedEnvironment` method with inline refresh. Added `OAuthGrantRepo`, `ManagedEnvironmentService`, `OAuthTokenRefreshService`, `McpServerRepo` dependencies. Runs BEFORE `injectMcpEnvFromPersonalEnvironment`.

**Verification:**
- Go: `go build ./backend/services/stigmer-server/...` passes
- Java: `bazel build //backend/services/stigmer-service/...` passes (36 targets)

## Previous Sessions

### T02 Completed (Session 2): ManagedEnvironmentService + CompleteOAuthConnect Rewiring
### T01 Completed (Session 1): Proto + Schema Foundation

(See `tasks.md` for full details of prior sessions.)

## Next Steps

1. **T04: Frontend** — Backend query handlers (`getOAuthGrantStatus` implementation) + React hooks + UI component updates. Filter managed environments from environment list. Hide edit/delete for managed envs.
2. **T05: Migration + End-to-End Validation** — Clean up existing data and validate all flows.

## Context for Resume

- The `getOAuthGrantStatus` RPC is proto-defined but not yet implemented (handler implementation is T04).
- The `PendingOAuthState` (Go + Java) was NOT renamed — it's MCP-specific by design and stays with `McpServerID`.
- Go OSS mode uses empty string `""` for `identity_account_id` — this pattern continues.
- **All three consumption paths (connect, refresh, session injection) now use managed environments** (T03 complete).
- `resolveOrCreatePersonalEnvironmentID` has been deleted from Go.
- `findPersonalEnvironment` has been deleted from Java `OAuthTokenRefreshService`.
- `resolveFromPersonalEnvironment` is preserved in both Go `connect.go` and Java `McpServerConnectHandler` — handles non-OAuth env vars.
- The env-declaration refactor (project 20260411.02) has been accounted for: all code uses `GetSpec().GetEnv()` / `getSpec().getEnvMap()` with `EnvVarDeclaration` and the `optional` flag.
- The managed environment name is `"OAuth: {mcpServerName}"`.
- The managed environment label is `stigmer.ai/managed=true`.

## Key Design Decisions Made

1. **`resource_id` instead of `mcp_server_id`**: OAuthGrant is now resource-agnostic (T01).
2. **Downstream layer for managed env operations**: No direct repo access (T02).
3. **Re-connect reuse**: Existing managed environment reused on re-connect (T02).
4. **Split resolution in connect handlers**: OAuth vars from managed env + remaining from personal env, merged at the caller (T03).
5. **Inline refresh in session injection**: Non-fatal, best-effort refresh before reading tokens (T03).
6. **Cross-domain grant read**: AgentExecution reads from OAuthGrantStore (MCP domain) — acceptable read-only access (T03).

## Key References

- **Predecessor project**: `_projects/2026-04/20260410.03.mcp-oauth-connect/next-task.md`
- **Task list**: `_projects/2026-04/20260411.01.mcp-oauth-managed-credentials/tasks.md`
- **Architect role**: `_roles/001_architect.md`
- **Plan file (T01)**: `.cursor/plans/t01_proto_schema_foundation_e74bbe93.plan.md`
- **Plan file (T02)**: `.cursor/plans/t02_managedenv_service_b1fd0b7a.plan.md`
- **Plan file (T03)**: `.cursor/plans/t03_oauth_managed_env_9d749410.plan.md`

---

*Drop this file into a new conversation to resume work on this project.*
