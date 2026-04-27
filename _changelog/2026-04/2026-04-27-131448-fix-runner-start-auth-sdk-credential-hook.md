# Fix Runner Start Auth and Add SDK Credential Hook for Platform Builders

**Date**: April 27, 2026

## Summary

Fixed the "Unable to issue credentials" error when starting a runner from the desktop app by removing the unnecessary `createLaunchToken`/`exchangeLaunchToken` round-trip. Extracted credential resolution into a new `useRunnerCredential` SDK hook so platform builders can start runners from their own apps without reimplementing auth logic. On the backend, changed `LaunchTokenService` to pass through the caller's existing credential instead of re-minting via the PlatformClient JWT issuer.

## Problem Statement

When clicking "Start Runner" in the desktop app, the UI showed:

> Failed to start runner: StigmerError: Unable to issue credentials → contact your administrator

### Pain Points

- The desktop app called `createLaunchToken` then immediately `exchangeLaunchToken` in the same process — a server round-trip that re-minted the user's Auth0 JWT as a Stigmer-signed JWT via `StigmerJwtIssuer.mintUserToken()`. This failed when `STIGMER_JWT_SIGNING_KEY` was not configured on the backend.
- The PlatformClient JWT issuer was being misused: direct Stigmer users (Auth0 login) ended up with PlatformClient-style tokens with `platform_client_id = null`.
- For API key users (`stk_*`), the `resolveCallerClaims()` method tried to decode the opaque key as a JWT and silently lost email/name claims.
- No SDK hook existed for the in-app runner start scenario — credential resolution was hand-rolled in `client-apps/desktop`, forcing platform builders to rediscover the same pattern.

## Solution

Three-layer fix across SDK, desktop app, and backend:

1. **New SDK behavior hook** (`useRunnerCredential`) that resolves the current auth credential from the Stigmer client — works with Auth0 JWT, PlatformClient JWT, and API keys.
2. **Desktop app** consumes the SDK hook instead of reaching into its own auth layer.
3. **Backend** `LaunchTokenService` stores the caller's existing Bearer credential in Redis instead of re-minting via `StigmerJwtIssuer`.

## Implementation Details

### New: `useRunnerCredential` hook (`@stigmer/react`)

- **File**: `sdk/react/src/runner/useRunnerCredential.ts`
- Calls `useStigmer()` to get the client, then `client.getAuthCredential()` to resolve the token
- Returns `{ token, endpoint, org }` — everything a sidecar process needs
- Zero framework dependencies (no Tauri, no Electron)
- Exported from `sdk/react/src/runner/index.ts` and the top-level barrel

### Desktop app `RunnersPage` simplified

- **File**: `client-apps/desktop/src/pages/runners/RunnersPage.tsx`
- Replaced `useAuth().getAccessToken()` with `useRunnerCredential().getCredential()`
- Removed `useAuth` import, `BASE_URL` constant, `CreateLaunchTokenRequestSchema`/`ExchangeLaunchTokenRequestSchema` imports, `useStigmer`/`create` imports
- Removed launch-token-specific error messages from `describeStartFlowError`

### Backend `LaunchTokenService` pass-through (stigmer-cloud)

- **File**: `LaunchTokenService.java`
- Removed `StigmerJwtIssuer` dependency entirely
- `create()` now stores `caller.getAccessToken()` directly in Redis
- Removed `resolveCallerClaims()` method
- Throws `UNAUTHENTICATED` (not `INTERNAL`) when no credential is available
- Tests updated to verify pass-through behavior for both JWT and API key credentials

## Benefits

- **Fixes the error**: Runner start works without `STIGMER_JWT_SIGNING_KEY` configured
- **Auth-type agnostic**: Works for Auth0 JWT, PlatformClient JWT, and API key users
- **SDK-first**: Platform builders get a ready-made hook for starting runners from their own apps
- **Simpler architecture**: No unnecessary JWT re-minting; credentials flow through as-is
- **Cleaner separation**: PlatformClient JWT issuer is only used for its intended purpose (`mintUserToken` RPC)

## Impact

- **Direct users**: "Start Runner" button in the desktop app works immediately
- **Platform builders**: New `useRunnerCredential` hook available for building custom runner management UIs
- **Deep-link flow**: Still works — `useLaunchLocalRunner` and `useDeepLinkHandler` are unchanged, but `LaunchTokenService` now stores the original credential instead of re-minting

## Related Work

- `useLaunchLocalRunner` hook (browser-to-desktop deep-link flow) remains unchanged
- `useDeepLinkHandler` in desktop app remains unchanged
- `StartRunnerDialog` component unchanged

---

**Status**: ✅ Production Ready
