# Desktop Cloud Auth: PKCE via Deep Link + Environment-Based API Routing

**Date**: April 25, 2026

## Summary

Fixed the desktop app's "Failed to load organizations" error by addressing two root causes: the API URL defaulted to a wrong localhost port (9090 instead of 7234) with no production override, and the PKCE auth callback mechanism used `localStorage` storage events that cannot work in a Tauri desktop context (system browser and webview are separate origins). Replaced the broken callback with OS-level `stigmer://auth/callback` deep link dispatch, created a dedicated Auth0 application for the desktop, added proper Auth0 session logout, and introduced Vite environment files to route dev builds to localhost and production builds to `api.stigmer.ai`.

## Problem Statement

Launching the released desktop app showed "Failed to load organizations / Load failed" with no way to authenticate.

### Pain Points

- `VITE_STIGMER_API_URL` was never set in the CI release workflow, so production builds baked in the hardcoded fallback `http://localhost:9090`
- The fallback port (9090) didn't match any known Stigmer server — the OSS local daemon runs on 7234
- Because the URL was localhost, `isAuthDisabled()` returned true, auth was bypassed, and the app tried to call `findMyOrganizations()` against a non-existent server
- Even if the URL were corrected to a cloud endpoint, the PKCE callback relied on `window.addEventListener("storage", ...)` — an approach that only works when the callback page and the main app share the same browser origin. In Tauri, the system browser and the webview are separate origins, so the storage event never fires
- No callback HTTP server existed in the Rust backend to bridge this gap
- The desktop app shared the CLI's Auth0 application (client ID `kIT6URf4HKn6YzrQVVFTFN63BrSJdTPM`), mixing callback URLs and token settings across two different surfaces
- Logout only cleared local tokens without invalidating the Auth0 session, so "Sign out → Sign in" would silently re-authenticate

## Solution

Replaced the localhost callback mechanism with the `stigmer://` deep link scheme already registered by the desktop app (from T05), created a dedicated Auth0 application, and added Vite environment files so the correct API URL is baked in per build mode.

## Implementation Details

### Environment-based API routing

Created two Vite environment files in `client-apps/desktop/`:

- `.env.development` — `VITE_STIGMER_API_URL=http://localhost:7234` (correct OSS daemon port)
- `.env.production` — `VITE_STIGMER_API_URL=https://api.stigmer.ai` (Stigmer Cloud)

Updated the hardcoded fallback in both `App.tsx` and `AuthProvider.tsx` from port 9090 to 7234 as a defensive default.

### Dedicated Auth0 application

Created "Stigmer Desktop" (Native) in Auth0 with its own client ID (`Ix1qNUI0uC82GPmghcrThei8IjtjIEA0`). Configuration:

- Allowed Callback URLs: `stigmer://auth/callback`
- Allowed Logout URLs: `stigmer://auth/logout`
- Grant Types: Authorization Code + Refresh Token
- Token Endpoint Auth Method: None (PKCE replaces client secret)
- No client secret embedded in the app

### Deep link PKCE callback

Rewrote the auth flow in `AuthProvider.tsx`:

- **`openAuthFlow(authUrl, expectedState)`** — Registers a `onOpenUrl` deep link listener (via `@tauri-apps/plugin-deep-link`), awaits registration to avoid a race, then opens the system browser with `open()` from `@tauri-apps/plugin-shell`. When Auth0 redirects to `stigmer://auth/callback?code=...&state=...`, the OS dispatches it to the running app. The handler validates state, extracts the code, and resolves the promise. Cleanup (`unlisten`) runs in a `finally` block.
- **`parseCallbackUrl(raw)`** — Parses `stigmer://auth/callback?...` URLs, extracts `code`, `state`, `error`, `error_description`. Returns null for non-matching URLs so the existing `useDeepLinkHandler` (runner launches) is unaffected.
- Timeout remains at 5 minutes, matching the previous behavior.

### Auth0 session logout

`logout()` now opens `https://stigmer-prod.us.auth0.com/v2/logout?client_id=...&returnTo=stigmer://auth/logout` in the system browser after clearing local tokens. This invalidates the Auth0 session so subsequent logins show the login prompt instead of silently re-authenticating. The `stigmer://auth/logout` return URL brings the app back to the foreground.

### CSP update

Added `https://stigmer-prod.us.auth0.com` to the `connect-src` directive in `tauri.conf.json`. Without this, the PKCE token exchange (`fetch` to `/oauth/token`) would be blocked by the Content Security Policy.

## Benefits

- Released desktop builds connect to Stigmer Cloud and show the login screen instead of the org-loading error
- Dev builds connect to the local OSS server on the correct port (7234)
- Auth callback works reliably via OS-level URL dispatch — no localhost servers, no cross-origin hacks
- Desktop has its own Auth0 application with isolated configuration
- Logout properly invalidates the Auth0 session
- Deep link coexistence: auth callbacks (`stigmer://auth/...`) and runner launches (`stigmer://launch-runner?...`) are handled independently

## Impact

- **Desktop app** — Cloud login flow is now functional end-to-end
- **Auth0** — New "Stigmer Desktop" application created, separate from CLI and Mobile
- **CSP** — Auth0 domain added to allowed connect sources
- **No breaking changes** — Local/OSS mode, CLI, web console, and runner management are all unaffected

## Files Changed

| File | Change |
|------|--------|
| `client-apps/desktop/.env.development` | **New** — local dev API URL |
| `client-apps/desktop/.env.production` | **New** — production cloud API URL |
| `client-apps/desktop/src/App.tsx` | Fixed fallback port 9090 → 7234 |
| `client-apps/desktop/src/auth/AuthProvider.tsx` | Rewrote PKCE callback (deep link), added Auth0 logout |
| `client-apps/desktop/src/auth/pkce.ts` | Updated client ID to Stigmer Desktop app |
| `client-apps/desktop/src-tauri/tauri.conf.json` | Added Auth0 domain to CSP `connect-src` |

## Related Work

- T05: `stigmer://` URL scheme handling (provided the deep link infrastructure reused here)
- T03: Core app shell — auth provider, org provider, login screen
- `_changelog/2026-03/2026-03-31-*-migrate-endpoints-to-stigmer-ai-domain.md` — `api.stigmer.ai` endpoint establishment

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
