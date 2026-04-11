# OAuth Connect, Refresh, and Session Injection via Managed Environments

**Date**: April 11, 2026

## Summary

All three OAuth token consumption paths — connect env resolution, pre-flight token refresh, and session execution context injection — now read and write tokens from system-managed environments via `grant.environmentId`. Personal environments are no longer touched by OAuth flows, completing the separation of system-managed credentials from user-managed credentials.

## Problem Statement

After T02, `CompleteOAuthConnect` wrote tokens to a managed environment and stored its ID on the OAuthGrant. However, all consumption paths still read from personal environments, creating a write-to-managed / read-from-personal mismatch. Any tokens stored in managed environments were invisible to connect, refresh, and session execution flows.

### Pain Points

- Token refresh wrote back to personal environments, bypassing the managed environment entirely
- Connect env resolution only looked in personal environments, missing OAuth tokens in managed envs
- Session execution context had no OAuth awareness — MCP server tokens were either absent or resolved from personal env
- The `resolveOrCreatePersonalEnvironmentID` function auto-created personal environments unnecessarily during OAuth flows

## Solution

Split all token I/O by source: OAuth-managed variables come from the grant's managed environment, everything else comes from the user's personal environment. The two maps are merged at the caller, keeping the general-purpose personal-env resolver domain-neutral and unaware of OAuth concerns.

## Implementation Details

### Refresh Path (Go + Java)

**Go `connect.go`**: `refreshOAuthTokenIfNeeded` now reads the refresh token via `managedEnvService.ReadSecretValue(grant.EnvironmentID, grant.RefreshTokenEnvVar)` and writes refreshed tokens via `managedEnvService.UpdateSecrets`. The `resolveOrCreatePersonalEnvironmentID` function was deleted — no callers remain.

**Java `OAuthTokenRefreshService`**: Replaced `EnvironmentQueryGrpcRepo` / `EnvironmentCommandGrpcRepo` with `ManagedEnvironmentService`. Deleted `findPersonalEnvironment` and `PERSONAL_ENV_LABEL`. All token I/O goes through `grant.getEnvironmentId()`.

### Connect Env Resolution (Go + Java)

Both connect handlers now call a new `resolveOAuthVarsFromManagedEnv` function first:
1. Look up grant for the MCP server
2. If grant exists with an `EnvironmentID`: read the OAuth var from managed env
3. Build a reduced declarations map (exclude the OAuth var key)
4. Call `resolveFromPersonalEnvironment` with the reduced map for remaining vars
5. Merge both maps

`resolveFromPersonalEnvironment` stays unchanged — it resolves whatever declarations it receives from the personal env, with no OAuth awareness.

### Session Injection (Go + Java)

New `injectMcpOAuthFromManagedEnvironment` function in both `CreateExecutionContextStep` files:
- Iterates the agent's `mcp_server_usages`
- For each MCP server with `spec.auth`: looks up the grant, performs inline pre-flight refresh if expired, reads the access token from the managed environment
- Runs BEFORE `injectMcpEnvFromPersonalEnvironment` (Java) / after workspace key injection (Go), so OAuth keys are already present when personal env injection runs

### Wiring

Go `AgentExecutionController` gains `SetOAuthDependencies(oauthGrantStore, managedEnvService)`. Wired in `server.go` alongside existing MCP controller OAuth wiring.

### Proto Comments

Updated `McpServerAuth` and `McpServerSpec.auth` comments in `spec.proto` — all references to "personal environment" replaced with "system-managed environment" / "grant's managed environment".

## Benefits

- **Clean separation**: OAuth tokens live exclusively in managed environments. Personal environments hold only user-managed credentials.
- **No collision risk**: OAuth flows never touch personal environments, eliminating the possibility of overwriting user credentials.
- **Authoritative token locator**: `grant.environmentId` is the single source of truth for all token reads and writes across all flows.
- **Inline refresh during execution**: Sessions no longer start with expired tokens — pre-flight refresh happens inline during execution context creation.

## Impact

- **Go**: 7 files changed (+314 -67) in stigmer
- **Java**: 2 files changed (+213 -18) in stigmer-cloud (OAuthTokenRefreshService already committed separately)
- **Proto**: 1 file — comment-only changes (no wire-breaking changes)
- **Agent-runner (Python)**: Zero changes — reads from `ExecutionContext` regardless of variable source

## Related Work

- **T01**: Proto + Schema Foundation (generalized OAuthGrant to resource-agnostic)
- **T02**: ManagedEnvironmentService + CompleteOAuthConnect (write path)
- **T03**: This changelog — Connect + Refresh + Session Injection (all read paths)
- **Next (T04)**: Frontend — `getOAuthGrantStatus` handler + React hooks + UI
- **Env-declaration refactor** (project 20260411.02): `env_spec` → `env` migration completed concurrently; T03 uses the new `EnvVarDeclaration` API throughout

---

**Status**: ✅ Production Ready
**Timeline**: T03 of 5-task project (20260411.01.mcp-oauth-managed-credentials)
