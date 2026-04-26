# Desktop Dev Mode: Localhost Auth Callback Server

**Date**: April 26, 2026

## Summary

Added a localhost HTTP callback server for OAuth authentication in desktop dev mode, replacing the `stigmer://` deep link that conflicts with the production app. Also switched the dev API URL to Stigmer Cloud so the desktop app connects to the real backend during development.

## Problem Statement

When running `make desktop-dev`, the desktop app couldn't complete the Auth0 login flow because the `stigmer://auth/callback` deep link was intercepted by the production `/Applications/Stigmer.app` instead of the running dev instance. Additionally, the dev environment defaulted to `localhost:7234`, requiring a local backend server to be running.

### Pain Points

- Clicking "Open Stigmer" in the browser after Auth0 login redirected to the production app, not the dev instance
- The dev instance never received the OAuth callback, leaving the login flow stuck
- macOS associates custom URL schemes with installed `.app` bundles — the bare dev binary couldn't compete
- Developers had to run a full local backend stack just to work on the desktop app

## Solution

Introduced a one-shot localhost HTTP server on the Rust side that receives the OAuth callback via `http://127.0.0.1:<port>/auth/callback` in dev mode. Production builds continue using the `stigmer://` deep link unchanged.

## Implementation Details

- **`auth.rs`**: Added `start_auth_callback_server` Tauri command that binds a `TcpListener` on port 17234 (with 17235/17236 as fallbacks), accepts one HTTP request, extracts the OAuth `code`/`state`/`error` params, emits the `auth-callback` event, returns a "you can close this tab" HTML page, and focuses the app window
- **`lib.rs`**: Registered the new command in the Tauri invoke handler
- **`AuthProvider.tsx`**: The `login` callback now checks `import.meta.env.DEV` — if true, it calls `start_auth_callback_server` to get a port and uses the localhost URL as the redirect URI; otherwise, it falls back to the `stigmer://auth/callback` deep link
- **`.env.development`**: Switched `VITE_STIGMER_API_URL` from `http://localhost:7234` to `https://api.stigmer.ai`

## Benefits

- Developers can run `make desktop-dev` and log in without needing a local backend or conflicting with the production app
- Zero changes to production behavior — deep links remain the auth mechanism for bundled releases
- Auth0 only requires adding three deterministic localhost callback URLs (one per fallback port)

## Impact

- **Desktop developers**: Can now authenticate against Stigmer Cloud in dev mode out of the box
- **Auth0 tenant config**: Requires `http://127.0.0.1:17234/auth/callback`, `http://127.0.0.1:17235/auth/callback`, and `http://127.0.0.1:17236/auth/callback` in the Allowed Callback URLs

---

**Status**: ✅ Production Ready
