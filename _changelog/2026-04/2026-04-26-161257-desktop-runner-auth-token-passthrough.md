# Desktop Runner: Auto-Inject Auth Token to CLI Sidecar

**Date**: April 26, 2026

## Summary

Fixed "Start Runner" in the desktop app silently failing because the CLI sidecar was never given the desktop app's Auth0 access token. The sidecar now automatically receives the desktop session's token and API endpoint, matching the behavior already used by the deep-link launch flow.

## Problem Statement

Clicking "Start Runner" in the desktop Runners page appeared to do nothing. The dialog opened and closed, but no runner ever appeared in the list.

### Pain Points

- The desktop app authenticates via Auth0 PKCE and holds a valid access token, but when spawning `stigmer up runner` as a Tauri sidecar, it never forwarded that token
- The CLI sidecar fell back to its own credential store (`~/.stigmer/`), which could be expired or unconfigured
- The runner process would die immediately due to auth failure with zero visible feedback
- Users had to separately run `stigmer auth login` in a terminal -- a confusing requirement when they were already logged in to the desktop app

## Solution

In `SettingsRunners.tsx`, the `handleStart` callback now resolves the token and endpoint before passing them to the sidecar. When the user leaves the dialog's Token and Endpoint fields empty (the common case), the desktop app's own access token and configured API URL are used as defaults.

## Implementation Details

- Added `useAuth()` call to `SettingsRunners` to access `getAccessToken()`
- Added `BASE_URL` constant (same `VITE_STIGMER_API_URL` source as `App.tsx`)
- `handleStart` builds `resolvedOpts` that falls back to `getAccessToken()` for token and `BASE_URL` for endpoint
- User-provided values in the dialog still take precedence (explicit input wins over fallback)

## Benefits

- "Start Runner" works immediately after desktop login -- no separate CLI auth step
- Consistent with the deep-link flow (`useDeepLinkHandler.ts`) which already passes token and endpoint
- No changes to the Tauri/Rust layer or CLI -- only the React component needed updating

## Impact

- **Desktop app users**: Runner start now works out of the box after logging in
- **Scope**: Single file change (`SettingsRunners.tsx`), ~5 lines added

---

**Status**: Production Ready
