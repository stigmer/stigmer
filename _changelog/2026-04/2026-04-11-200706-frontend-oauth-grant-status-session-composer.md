# Frontend OAuth Grant Status + Session Composer

**Date**: April 11, 2026

## Summary

Implemented `getOAuthGrantStatus` backend handlers in Go and Java, created a standalone `useOAuthGrantStatus` React data hook, and rewired `useMcpServerCredentials` and `useMcpServerSetup` to derive OAuth connection state from the grant status API instead of checking for tokens in the personal environment. Managed environments are now filtered from the environment list UI.

## Problem Statement

After T01–T03 moved OAuth tokens from personal environments into system-managed environments, the frontend still checked for OAuth connection by looking for the `target_env_var` key in the personal environment. This personal-env key check would always return `false` because the token now lives in a managed environment that the personal env hook never sees.

### Pain Points

- `useMcpServerCredentials.isOAuthConnected` was `false` for connected OAuth servers (token no longer in personal env)
- `useMcpServerCredentials.isReady` was `false` for OAuth servers even when the grant existed and all manual vars were present
- `useMcpServerSetup.addServer` treated OAuth target vars as missing, sending users to credential forms unnecessarily
- The `McpServerDetailView` ConnectBar showed "Not connected" for servers with active OAuth grants
- Managed environments appeared alongside user environments in the settings list, creating confusion

## Solution

Introduced a dedicated `getOAuthGrantStatus` RPC that queries the grant store directly (not the environment), and wired it through the full stack: Go handler → Java handler → TypeScript SDK (already existed) → React data hook → credential and setup hook composition → UI updates.

## Implementation Details

### Backend Handlers

**Go** (`get_oauth_grant_status.go`): Simple method on `McpServerController` — no pipeline, just `oauthGrantStore.Find(ctx, "", resourceId, org)` with nil-guard. Returns `{Connected: false}` when no grant exists.

**Java** (`McpServerGetOAuthGrantStatusHandler.java`): `CustomOperationHandlerV2` with standard pipeline: validate → extractResourceId → authorize (FGA `can_view` on `mcp_server`) → `LookupGrant` (nested `@Component` step with `OAuthGrantRepo`) → sendResponse.

### React SDK

**`useOAuthGrantStatus`** (new standalone hook): Follows the `useMcpServer` pattern — `useStigmer()`, `useEffect` with cancellation, `fetchKey` for refetch. Returns `{ connected, accessTokenExpiresAt, targetEnvVar, authMethod, isLoading, error, refetch }`. Exported independently for platform builders.

**`useMcpServerCredentials`** (rewired): Composes `useOAuthGrantStatus` internally. `isOAuthConnected` now from grant status (was: `existingKeys.has(oauthTargetEnvVar)`). `isReady` gates on both data sources. Added `accessTokenExpiresAt` to return type for actual expiry display.

**`useMcpServerSetup`** (updated): `addServer` makes an imperative `getOAuthGrantStatus` call for OAuth-configured servers. When grant is connected, the target var is added to `existingKeys` before `diffEnv`, so it's treated as present. The `McpServerPicker`'s existing derivation of `isConnected` from `missingVariables` is naturally correct without any reducer changes.

### UI Updates

**ConnectBar**: Gains `accessTokenExpiresAt` prop. New `formatTokenExpiry` function renders relative time ("Expires in 47 min", "Expires in 2h 15m", "Token expired"). Falls back to the static `tokenLifetimeHint` when expiry is zero.

**`EnvironmentListPanel`**: `excludeLabels` prop widened from `Record<string, string>` to `Record<string, string> | Record<string, string>[]` — OR-of-AND semantics for array input, backward-compatible for single-record callers.

**`EnvironmentsSection`** (Console): Now excludes both `stigmer.ai/personal` and `stigmer.ai/managed` labeled environments from the org list.

## Benefits

- OAuth connection state is now authoritative — derived from the grant store, not inferred from personal environment contents
- `McpServerPicker` and `McpServerConfigPanel` required zero changes — the data flows through naturally
- Platform builders get a standalone `useOAuthGrantStatus` hook for custom OAuth UIs
- Actual token expiry time displayed in the ConnectBar (was: only static hint from spec)
- Managed environments hidden from user-facing environment lists, preventing confusion
- `EnvironmentListPanel.excludeLabels` array support is a general-purpose SDK improvement

## Impact

- **Users**: OAuth servers display correct "Connected" status. ConnectBar shows real token expiry. Managed environments are invisible in settings.
- **Platform builders**: New `useOAuthGrantStatus` hook is independently importable. `EnvironmentListPanel` supports richer exclusion patterns.
- **Codebase**: Clean separation — OAuth state detection uses a dedicated API, not side-channel observation of environment contents.

## Related Work

- T01: Proto + Schema Foundation (same project)
- T02: ManagedEnvironmentService + CompleteOAuthConnect (same project)
- T03: Connect + Refresh + Session Injection via managed environments (same project)
- Predecessor: `_projects/2026-04/20260410.03.mcp-oauth-connect`

---

**Status**: ✅ Production Ready
**Timeline**: T04 of 5-task project (20260411.01.mcp-oauth-managed-credentials)
