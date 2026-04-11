# Next Task: 20260411.01.mcp-oauth-managed-credentials

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260411.01.mcp-oauth-managed-credentials

**Description**: Separate OAuth token storage from personal environments into per-(user, org, resource) managed environments with strict mutation protection. Generalized OAuthGrant to be resource-agnostic (keyed by identity_account_id, resource_id, org_id). Use grant.environmentId as the authoritative token locator across connect, refresh, and session execution flows.
**Goal**: Clean separation of system-managed OAuth credentials from user-managed personal environments, eliminating collision risk and mixed concerns.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-11
**Status**: T01 DONE, T02 NEXT
**Active Task**: T02 — ManagedEnvironmentService + CompleteOAuthConnect
**Last Session**: 2026-04-11 (T01 completed — proto + schema foundation)

## Session Progress (2026-04-11)

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

**Verification:**
- Go: `go build ./...` passes
- Java: `bazel build //backend/services/stigmer-service/...` passes (36 targets)

## Next Steps

1. **T02: ManagedEnvironmentService + CompleteOAuthConnect** — Create the managed environment service (Go + Java), mutation guards, and rewire CompleteOAuthConnect to use managed environments instead of personal environments.
2. **T03: Connect + Refresh + Session Injection** — Update all three consumption paths to read OAuth tokens from managed environments via `grant.environmentId`.
3. **T04: Frontend** — Backend query handlers + React hooks + UI component updates.
4. **T05: Migration + End-to-End Validation** — Clean up existing data and validate all flows.

## Context for Resume

- The `getOAuthGrantStatus` RPC is proto-defined but not yet implemented (handler implementation is T04).
- The `PendingOAuthState` (Go + Java) was NOT renamed — it's MCP-specific by design and stays with `McpServerID`.
- Go OSS mode uses empty string `""` for `identity_account_id` — this pattern continues.
- The code still writes tokens to personal environment (T02 will change this to managed environments).

## Key Design Decisions Made This Session

1. **`resource_id` instead of `mcp_server_id`**: OAuthGrant is now resource-agnostic. The code still lives in `mcpserver/oauth/` — move to shared location when second consumer arrives.
2. **`resource_kind` field added**: For query filtering and handler routing. Not part of the primary key.
3. **`resource_id` instead of `ApiResourceReference`**: Discussed using slug-based references but chose system IDs — all consumption paths have the ID at hand, slugs could be renamed, and the grant is an infrastructure record (not a user-facing YAML resource).
4. **`getOAuthGrantStatusInput` uses `resource_id`**: Generic, matching the grant model. The MCP-specific RPCs (initiate/complete) keep `mcp_server_id`.

## Key References

- **Predecessor project**: `_projects/2026-04/20260410.03.mcp-oauth-connect/next-task.md`
- **Task list**: `_projects/2026-04/20260411.01.mcp-oauth-managed-credentials/tasks.md`
- **Architect role**: `_roles/001_architect.md`
- **Plan file**: `.cursor/plans/t01_proto_schema_foundation_e74bbe93.plan.md`

---

*Drop this file into a new conversation to resume work on this project.*
