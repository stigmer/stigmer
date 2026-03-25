# Fix OIDC Logout Race Condition in Web Console

**Date**: March 25, 2026

## Summary

Fixed a race condition in the OIDC authentication provider that prevented logout from working. The `signoutRedirect()` call internally fires a `userUnloaded` event before navigating, which caused `AuthGuard` to hijack the browser navigation and redirect to login instead of the Auth0 logout endpoint.

## Problem Statement

Users running the Stigmer web console (both local dev and production) were unable to log out. Clicking "Sign out" appeared to do nothing — the user remained authenticated.

### Pain Points

- Clicking "Sign out" had no visible effect; the user stayed logged in
- No error was surfaced in the UI — the failure was completely silent
- The `signoutRedirect()` Promise was fire-and-forget with no error handling
- The root cause was non-obvious: a timing interaction between `oidc-client-ts` internals and React's effect scheduling

## Solution

Introduced an `isLoggingOut` state flag that prevents `AuthGuard` from triggering a login redirect while a logout is in progress. Added proper error handling with a fallback to Auth0's `/v2/logout` endpoint.

## Implementation Details

**Race condition sequence (before fix)**:

1. `logout()` calls `signoutRedirect()`
2. `oidc-client-ts` internally calls `removeUser()` which clears sessionStorage
3. `removeUser()` fires the `userUnloaded` event **synchronously**
4. The event handler sets `user` to `null`, making `isAuthenticated = false`
5. React re-renders → `AuthGuard`'s `useEffect` sees `!isAuthenticated`
6. `AuthGuard` calls `login()` → `signinRedirect()` navigates to Auth0's `/authorize`
7. The original `signoutRedirect()` never completes its navigation to `/oidc/logout`
8. Auth0 session is never cleared → user is silently re-authenticated

**Changes to `OidcAuthProvider.tsx`**:

- Added `isLoggingOut` state flag, set to `true` at the start of logout
- Exposed `isLoggingOut` through the auth state as `isLoading: isLoading || isLoggingOut`, which blocks `AuthGuard` from calling `login()` during logout
- Changed `logout` to an async function that awaits `signoutRedirect()`
- Added try/catch with a fallback: if `signoutRedirect()` fails (e.g. missing `id_token_hint`, stale OIDC metadata), manually navigates to Auth0's `/v2/logout` endpoint with `client_id` and `returnTo` parameters

## Benefits

- Logout now works reliably in both local development and production
- Silent failures are eliminated — errors are logged and handled with a fallback
- The Auth0 `/v2/logout` fallback provides resilience against `oidc-client-ts` edge cases

## Impact

- **Web console users**: Can now log out and switch accounts as expected
- **Security**: Auth0 sessions are properly terminated on logout
- **Files changed**: `client-apps/web/src/auth/oidc/OidcAuthProvider.tsx`

## Related Work

- Part of the OIDC authentication system introduced for cloud deployments
- `df7aa5b7` — recent env var unification for the web console

---

**Status**: ✅ Production Ready
