# Desktop: Embedded Auth0 Login Webview and Logout Cleanup

**Date**: April 25, 2026

## Summary

Replaced the desktop app's broken external-browser Auth0 login flow with an embedded webview window that renders Auth0's Universal Login page within the app. Also replaced the browser-popup logout with a clean, in-process refresh token revocation. The desktop auth experience is now fully self-contained — no external browser windows at any point.

## Problem Statement

The desktop app's "Sign in with Auth0" button was non-functional, and the intended flow (opening the system browser) was a poor UX pattern for a desktop application.

### Pain Points

- **Broken login**: The `shell:allow-open` Tauri capability was missing, causing `open(authUrl)` to silently fail — clicking "Sign in with Auth0" did nothing.
- **External browser auth**: Even if fixed, opening the system browser for login breaks focus, requires window switching, and relies on OS deep-link delivery (`stigmer://auth/callback`) which can fail on misconfigured systems (especially Linux).
- **Browser popup on logout**: Logout opened the system browser to Auth0's `/v2/logout` just to clear a session cookie, which is unnecessary for a desktop app using refresh tokens.

## Solution

Adopted the standard desktop OAuth pattern (used by VS Code, Slack, Discord, JetBrains): open the IdP's login page in a dedicated in-app webview window, intercept the callback redirect on the Rust side, and relay the authorization code to the frontend via Tauri events.

## Implementation Details

### Rust: Auth webview window (`auth.rs`)

New Tauri command `open_auth_window` that:
- Creates a secondary `WebviewWindow` (480x700, centered, titled "Sign in to Stigmer") navigating to the Auth0 authorize URL
- Registers an `on_navigation` handler that intercepts `stigmer://auth/callback` redirects before the webview navigates, extracts the authorization code/state/error from query params, emits an `auth-callback` event, and closes the window
- Detects user-initiated window close (cancellation) via `on_window_event` and emits an `auth-cancelled` event
- Uses `Arc<AtomicBool>` to coordinate between navigation and close handlers

### Frontend: Embedded auth flow (`AuthProvider.tsx`)

Replaced `openAuthFlow` — previously used `open()` from `@tauri-apps/plugin-shell` + `onOpenUrl` deep-link listener — with:
- `invoke("open_auth_window", { authUrl })` to open the embedded webview
- `listen("auth-callback")` / `listen("auth-cancelled")` for event-driven code receipt
- `LoginCancelledError` sentinel class so the login screen silently returns on window close (no error toast)

### Logout: Token revocation instead of browser redirect

- Added `revokeRefreshToken()` in `pkce.ts` — POSTs to Auth0's `/oauth/revoke` to invalidate the refresh token server-side
- Logout now clears local tokens immediately (instant UI update) and fire-and-forgets the revocation
- Removed the `open()` call to Auth0's `/v2/logout` — no browser window opens

### Window close guard fix (`lib.rs`)

The `CloseRequested` handler previously intercepted all windows and prevented close (hide-to-tray behavior). Added a `label == "main"` guard so only the main window is hidden — secondary windows like the auth popup close normally.

### Capability addition (`default.json`)

Added `shell:allow-open` for future external URL needs (docs links, support, etc.).

## Benefits

- **Login works**: The previously broken button now opens Auth0's Universal Login in a polished embedded window.
- **No external browser**: The entire auth lifecycle (login and logout) is self-contained within the desktop app.
- **Reliable callback**: Navigation interception on the Rust side is deterministic — no OS deep-link delivery to fail.
- **Clean logout**: No browser popup on logout. Instant local token clear with background server-side revocation.
- **Cancellation UX**: Closing the auth window silently returns to the login screen — intentional cancellation, not an error.

## Impact

- **Desktop users**: Auth flow goes from broken to polished. No more context switching to the browser.
- **Auth0 config**: No changes needed — the `stigmer://auth/callback` redirect URI stays the same, intercepted by `on_navigation` instead of OS deep links.
- **Deep-link handler**: Unaffected — `useDeepLinkHandler` continues to handle `stigmer://launch-runner` URLs independently.

---

**Status**: ✅ Production Ready
