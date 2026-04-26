# Desktop: System Browser Auth with Passkey/Touch ID Support

**Date**: April 26, 2026

## Summary

Replaced the embedded webview-based OAuth flow in the Stigmer desktop app with system browser authentication, fixing Google passkey/fingerprint failures and introducing a branded in-app login screen. This brings the desktop auth UX in line with Slack, VS Code, Figma, and other major desktop apps that follow RFC 8252.

## Problem Statement

The Stigmer desktop app (Tauri) opened Auth0's Universal Login inside an embedded child webview (WKWebView on macOS). When the OIDC flow redirected to Google, Google's sign-in page attempted passkey/fingerprint authentication via the WebAuthn API. WKWebView does not support WebAuthn, so the platform authenticator (Touch ID) was inaccessible. Google fell back to Bluetooth cross-device passkey verification, which failed with a "Something went wrong — Make sure Bluetooth is on" error.

### Pain Points

- Users could not sign in using Google passkeys or Touch ID on the desktop app
- The error message was confusing (referenced Bluetooth) with no clear recovery path
- The previous login screen was a blank spinner that auto-triggered the overlay — no user choice, no branding
- The embedded webview approach violated RFC 8252 (OAuth 2.0 for Native Applications) which recommends the system browser for native app auth

## Solution

Two changes working together:

1. **Branded in-app login screen** — replaced the auto-login spinner with a proper Stigmer-branded screen showing "Sign in with Google" and "Sign in with Email" buttons, plus waiting and error states
2. **System browser for OAuth** — when the user clicks a sign-in button, the system browser (Chrome, Safari) opens for the full OIDC flow; the callback returns via the existing `stigmer://auth/callback` deep-link scheme

## Implementation Details

### Rust (Tauri backend)

- **`auth.rs`**: Removed the embedded webview overlay (`open_auth_window`, `close_auth_overlay`). Added `open_auth_in_browser` (opens system browser via shell plugin) and `cancel_auth` (emits cancellation event). Made `AuthCallbackPayload` and `param()` `pub(crate)` for reuse in `lib.rs`.
- **`lib.rs`**: Registered a deep-link `on_open_url` handler that intercepts `stigmer://auth/callback` URLs, parses the OAuth query parameters, emits the `auth-callback` Tauri event, and brings the main window to the foreground.

### TypeScript (Frontend)

- **`pkce.ts`**: Added optional `connection` parameter to `buildAuthorizeUrl`. When set to `"google-oauth2"`, Auth0 skips its Universal Login page and redirects directly to Google.
- **`AuthProvider.tsx`**: Updated `login()` to accept an optional `connection` parameter. Switched `openAuthFlow` from `invoke("open_auth_window")` to `invoke("open_auth_in_browser")`. Removed the overlay auto-close effect.
- **`LoginScreen.tsx`**: Full redesign with three states — idle (branded login with sign-in options), waiting (browser spinner with reopen/cancel links), and error (message with retry). Google icon SVG included. No auto-login on mount.
- **`useDeepLinkHandler.ts`**: Added `isAuthCallback()` guard to prevent the runner deep-link handler from processing auth callback URLs.

## Benefits

- **Passkeys and Touch ID work** — system browsers have full WebAuthn/platform authenticator access
- **Shared browser sessions** — if the user is already signed into Google in their browser, authentication can complete almost instantly
- **RFC 8252 compliant** — follows the recommended pattern for native app OAuth
- **Branded first impression** — users see a proper Stigmer login screen with clear choices instead of a blank spinner
- **User control** — sign-in is user-initiated (button click), not auto-triggered on mount

## Impact

- Desktop app users who were blocked by the Google passkey error can now sign in
- The login UX matches industry-standard desktop apps (Slack, VS Code, Figma, Notion, Linear)
- No changes to the web console, PKCE token exchange, or backend auth — the fix is contained to the desktop client's auth presentation layer

## Related Work

- `2026-04-25-124936-desktop-cloud-auth-pkce-deep-link.md` — initial PKCE + deep-link auth setup
- `2026-04-25-133251-desktop-embedded-auth-webview.md` — embedded webview approach (now replaced)
- `2026-04-25-163607-desktop-auth-inline-overlay-auto-login.md` — overlay auto-login (now replaced)
- `2026-04-23-201449-desktop-deep-link-url-scheme-handling.md` — deep-link scheme registration (reused)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
