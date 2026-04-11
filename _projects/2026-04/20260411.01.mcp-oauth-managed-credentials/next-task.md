# Next Task: 20260411.01.mcp-oauth-managed-credentials

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260411.01.mcp-oauth-managed-credentials

**Description**: Separate OAuth token storage from personal environments into per-(user, org, resource) managed environments with strict mutation protection. Generalized OAuthGrant to be resource-agnostic (keyed by identity_account_id, resource_id, org_id). Use grant.environmentId as the authoritative token locator across connect, refresh, and session execution flows.
**Goal**: Clean separation of system-managed OAuth credentials from user-managed personal environments, eliminating collision risk and mixed concerns.
**Tech Stack**: Protocol Buffers, Go (stigmer-server), Java/Spring (stigmer-cloud), TypeScript/React (SDK/UI)

## Current Status

**Created**: 2026-04-11
**Status**: T01 DONE, T02 DONE, T03 DONE, T04 DONE, T05 NEXT
**Active Task**: T05 — Migration + End-to-End Validation
**Last Session**: 2026-04-11 (T04 completed — Frontend OAuth Grant Status + Session Composer)

## Session Progress (2026-04-11, Session 4)

### T04 Completed: Frontend — OAuth Grant Status + Session Composer

Backend `getOAuthGrantStatus` handlers implemented in Go and Java. React SDK now derives OAuth connection state from the grant status API instead of personal environment key presence. Managed environments are filtered from the environment list UI.

**Design decisions**:
- **No pipeline for Go handler**: `GetOAuthGrantStatus` is a simple grant store lookup — no pipeline framework needed, just a direct method on `McpServerController` with nil-guard for `oauthGrantStore`.
- **Standard common steps for Java handler**: Uses `extractResourceId` + `authorize` + custom `LookupGrant` step. Leverages the proto annotation `field_path = "resource_id"` + `can_view` permission for FGA authorization.
- **`useOAuthGrantStatus` is standalone**: Exported as a standalone hook for platform builders who need grant status without the full credentials logic. Composed internally by `useMcpServerCredentials`.
- **No `oauthStatus` on `McpServerSetupEntry`**: The `McpServerPicker` already derives `isConnected` from `missingVariables`. When `addServer` checks grant status and adds the OAuth target var to `existingKeys`, the picker's derivation is naturally correct — no reducer changes needed.
- **Pool re-evaluation skips OAuth (Option A)**: OAuth status only changes after explicit user action (sign-in), which triggers `addServer` re-run via `setup.onServerAdded(ref)`. The pool effect handles non-OAuth pool key changes only.
- **`excludeLabels` widened to accept array**: `EnvironmentListPanel` now supports OR-of-AND label exclusion — backward-compatible.
- **BigInt(0) instead of 0n**: The client-apps/web tsconfig targets ES2017 which doesn't support BigInt literals. All SDK code uses `BigInt(0)` and `BigInt(60)` instead of `0n` / `60n`.

**Changes made (stigmer — Go, 1 new file):**
- **`get_oauth_grant_status.go`**: New handler on `McpServerController`. Nil-guard for `oauthGrantStore`, input validation, `Find(ctx, "", resourceId, org)`, maps grant to output proto.

**Changes made (stigmer-cloud — Java, 1 new file):**
- **`McpServerGetOAuthGrantStatusHandler.java`**: `CustomOperationHandlerV2` with pipeline: validate → extractResourceId → authorize → `LookupGrant` (nested `@Component` step querying `OAuthGrantRepo.find`) → sendResponse.

**Changes made (stigmer — React SDK + Console, 9 files, +117 -29):**
- **`useOAuthGrantStatus.ts`** (new): Standalone data hook wrapping `getOAuthGrantStatus` API. Returns `{ connected, accessTokenExpiresAt, targetEnvVar, authMethod, isLoading, error, refetch }`.
- **`useMcpServerCredentials.ts`**: Composes `useOAuthGrantStatus`. `isOAuthConnected` now from grant status API (was: personal env key check). `isReady` gates on both grant and personal env loading. Added `accessTokenExpiresAt` to return type. `refetch` calls both sources.
- **`useMcpServerSetup.ts`**: `addServer` checks grant status for OAuth servers; adds target var to `existingKeys` when connected, so `diffEnv` treats it as present. Uses `create(GetOAuthGrantStatusInputSchema, ...)` for protobuf message construction.
- **`McpServerDetailView.tsx`**: `ConnectBar` gains `accessTokenExpiresAt` prop. New `formatTokenExpiry` helper renders relative time ("Expires in 47 min", "Token expired"). Falls back to `tokenLifetimeHint` when expiry is zero.
- **`EnvironmentListPanel.tsx`**: `excludeLabels` prop widened to `Record<string, string> | Record<string, string>[]`. Filter uses OR-of-AND semantics for array input.
- **`EnvironmentsSection.tsx`** (Console): Excludes both `stigmer.ai/personal` and `stigmer.ai/managed` labeled environments from the org list.
- **`mcp-server/index.ts`** + **`sdk/react/src/index.ts`**: Barrel exports for `useOAuthGrantStatus` + `UseOAuthGrantStatusReturn`.

**Verification:**
- Go: `go build ./backend/services/stigmer-server/...` passes
- Java: `bazel build //backend/services/stigmer-service/...` passes (36 targets)
- TypeScript SDK: `tsc --noEmit` passes (ES2022 target)
- TypeScript Web: `tsc --noEmit` passes (ES2017 target)

## Previous Sessions

### T03 Completed (Session 3): Connect + Refresh + Session Injection
### T02 Completed (Session 2): ManagedEnvironmentService + CompleteOAuthConnect Rewiring
### T01 Completed (Session 1): Proto + Schema Foundation

(See `tasks.md` for full details of prior sessions.)

## Next Steps

1. **T05: Migration + End-to-End Validation** — Wipe existing `oauth_grant` data (pre-launch). Validate all flows end-to-end: OAuth connect stores tokens in managed env, refresh reads from `grant.environmentId`, MCP connect resolves OAuth vars from managed env, session execution injects tokens correctly, frontend reflects grant status, managed envs hidden from list, mutation guard rejects user edits.

## Context for Resume

- All four implementation tasks (T01–T04) are complete.
- The `getOAuthGrantStatus` handler is implemented in both Go (OSS) and Java (Cloud).
- The TypeScript SDK client method was already present from T01 stub generation.
- `useOAuthGrantStatus` is a standalone hook — platform builders can import it independently.
- `useMcpServerCredentials` derives `isOAuthConnected` from the grant status API. The personal env key check is gone.
- `useMcpServerSetup.addServer` makes an imperative `getOAuthGrantStatus` call (not a hook) for OAuth servers before diffing env declarations.
- `McpServerPicker` and `McpServerConfigPanel` required NO changes — the data flows through naturally after the hook rewiring.
- `EnvironmentListPanel.excludeLabels` is now a union type `Record | Record[]`. Existing callers with single records are backward-compatible.
- `usePersonalEnvironment` was already safe — mutually exclusive labels.
- The pre-existing lint failure in `env_resolver_test.go` (`EnvSpec` field renamed to `Env` in prior project 20260411.02) is unrelated.

## Key Design Decisions Made

1. **`resource_id` instead of `mcp_server_id`**: OAuthGrant is now resource-agnostic (T01).
2. **Downstream layer for managed env operations**: No direct repo access (T02).
3. **Re-connect reuse**: Existing managed environment reused on re-connect (T02).
4. **Split resolution in connect handlers**: OAuth vars from managed env + remaining from personal env, merged at the caller (T03).
5. **Inline refresh in session injection**: Non-fatal, best-effort refresh before reading tokens (T03).
6. **Cross-domain grant read**: AgentExecution reads from OAuthGrantStore (MCP domain) — acceptable read-only access (T03).
7. **Standalone `useOAuthGrantStatus` hook**: Independently usable by platform builders (T04).
8. **No `oauthStatus` on reducer entry**: Picker derivation from `missingVariables` is naturally correct (T04).
9. **Pool effect skips OAuth re-evaluation**: OAuth changes require explicit user action → `addServer` re-run (T04).

## Key References

- **Predecessor project**: `_projects/2026-04/20260410.03.mcp-oauth-connect/next-task.md`
- **Task list**: `_projects/2026-04/20260411.01.mcp-oauth-managed-credentials/tasks.md`
- **Architect role**: `_roles/001_architect.md`
- **Plan file (T01)**: `.cursor/plans/t01_proto_schema_foundation_e74bbe93.plan.md`
- **Plan file (T02)**: `.cursor/plans/t02_managedenv_service_b1fd0b7a.plan.md`
- **Plan file (T03)**: `.cursor/plans/t03_oauth_managed_env_9d749410.plan.md`
- **Plan file (T04)**: `.cursor/plans/t04_oauth_frontend_0153e095.plan.md`

---

*Drop this file into a new conversation to resume work on this project.*
