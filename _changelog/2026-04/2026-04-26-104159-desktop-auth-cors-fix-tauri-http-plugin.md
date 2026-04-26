# Desktop Auth CORS Fix: Tauri HTTP Plugin for Native Fetch

**Date**: April 26, 2026

## Summary

Fixed the desktop app's "Load failed" error on the sign-in screen by replacing browser `fetch` calls with Tauri's native HTTP plugin. Auth0's "Native" application type does not return CORS headers, causing macOS WKWebView to block the token exchange response. The fix routes all Auth0 HTTP calls and SDK API calls through Tauri's Rust-side HTTP client, which bypasses browser CORS enforcement entirely.

## Problem Statement

After the PKCE deep-link auth flow was implemented (see `2026-04-25-124936-desktop-cloud-auth-pkce-deep-link.md`), users could authenticate in the system browser and the authorization code was successfully received via the `stigmer://auth/callback` deep link. However, the subsequent token exchange — a `fetch` POST to `https://stigmer-prod.us.auth0.com/oauth/token` — failed with WebKit's `TypeError: Load failed`.

### Pain Points

- The sign-in flow was completely broken for production desktop builds pointing to Stigmer Cloud
- The error message "Load failed" was cryptic — a raw WebKit `TypeError` with no context about what failed or why
- Testing required building a full production release (auth is disabled in dev mode against localhost), creating a long feedback loop
- Token refresh would also silently fail with the same CORS error, clearing stored tokens and forcing re-authentication

### Root Cause

Tauri v2 on macOS uses WKWebView. The webview's origin is `http://tauri.localhost`. When the standard browser `fetch` API sends a POST to Auth0's `/oauth/token`, WebKit checks the response for `Access-Control-Allow-Origin`. Auth0's "Native" application type does not return CORS headers by design — native apps are expected to make HTTP calls from native code, not from a webview. WebKit blocks the response and throws the `TypeError`.

## Solution

Added `tauri-plugin-http` to provide CORS-free native HTTP requests from Tauri's Rust side, and extended the `@stigmer/sdk` with a `fetch` injection point so the desktop app can route SDK API calls through the same native HTTP layer.

## Implementation Details

### Tauri HTTP plugin integration

- Added `tauri-plugin-http = "2"` to Cargo.toml
- Registered the plugin in `lib.rs`
- Added `@tauri-apps/plugin-http` to the desktop app's JS dependencies
- Configured capabilities with URL-scoped permissions for Auth0 and Stigmer API domains

### Auth module: native fetch for Auth0 calls

In `pkce.ts`, replaced the browser's global `fetch` with the import from `@tauri-apps/plugin-http` for three Auth0 HTTP calls:
- `exchangeCode()` — authorization code → token exchange
- `refreshAccessToken()` — silent token refresh
- `revokeRefreshToken()` — logout token revocation

### SDK `fetch` injection (non-breaking)

Added an optional `fetch` field to `StigmerConfig` in `@stigmer/sdk`. When provided, it's passed through to the connect-rpc transport factory. When omitted, the transport uses the browser's global `fetch` as before. This enables any non-browser environment (Tauri, Electron, React Native) to inject a custom fetch implementation.

### Desktop app wiring

In `App.tsx`, imported Tauri's `fetch` and passed it to the `Stigmer` client constructor, ensuring all SDK API calls to `api.stigmer.ai` also bypass CORS.

### Error message improvement

Added a `toNetworkError()` helper in `pkce.ts` that wraps raw `TypeError` network errors with descriptive messages explaining what operation failed, the underlying error, and a hint about possible causes.

## Benefits

- Desktop sign-in flow works end-to-end for production builds
- Token refresh works silently without CORS failures
- Error messages are actionable instead of cryptic "Load failed"
- Auth can now be tested locally in dev mode with `VITE_STIGMER_FORCE_AUTH=true`
- SDK gains a clean, non-breaking `fetch` injection point for any non-browser consumer

## Impact

- **Desktop app** — Sign-in and token refresh are now functional against Stigmer Cloud
- **`@stigmer/sdk`** — New optional `fetch` field on `StigmerConfig` (non-breaking public API addition)
- **No server-side changes** — The fix is entirely client-side; no CORS configuration changes on the API server or Auth0
- **No breaking changes** — Local/OSS mode, CLI, web console, and runner management are unaffected

## Files Changed

| File | Change |
|------|--------|
| `client-apps/desktop/src-tauri/Cargo.toml` | Added `tauri-plugin-http = "2"` |
| `client-apps/desktop/src-tauri/src/lib.rs` | Registered HTTP plugin |
| `client-apps/desktop/src-tauri/capabilities/default.json` | Added scoped HTTP permissions |
| `client-apps/desktop/package.json` | Added `@tauri-apps/plugin-http` |
| `client-apps/desktop/src/auth/pkce.ts` | Switched to Tauri fetch, added error wrapping |
| `client-apps/desktop/src/App.tsx` | Injected Tauri fetch into Stigmer client |
| `sdk/typescript/src/config.ts` | Added optional `fetch` field to `StigmerConfig` |
| `sdk/typescript/src/transport.ts` | Passed custom `fetch` to connect-rpc transport |

## Related Work

- `2026-04-25-124936-desktop-cloud-auth-pkce-deep-link.md` — PKCE deep-link flow (provided the auth infrastructure this fix completes)
- `2026-04-26-084902-desktop-system-browser-auth-passkey-fix.md` — System browser auth (the auth opening mechanism this fix's token exchange completes)

---

**Status**: ✅ Production Ready
**Timeline**: ~45 minutes
