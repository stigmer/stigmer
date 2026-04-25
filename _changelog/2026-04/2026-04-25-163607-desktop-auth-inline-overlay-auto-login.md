# Desktop Auth: Inline Overlay and Auto-Login

**Date**: April 25, 2026

## Summary

Replaced the desktop app's two-step authentication flow (intermediate button screen + popup window) with a single-step experience where Auth0's Universal Login renders directly inside the main window as a full-window overlay, triggered automatically on app launch when the user is unauthenticated.

## Problem Statement

The Stigmer Desktop app's sign-in flow had two friction points that made it feel disconnected from the native app experience.

### Pain Points

- Users saw an unnecessary intermediate "Sign in with Auth0" button screen before being able to authenticate
- Clicking the button opened a **separate popup window** for the Auth0 login, which felt like leaving the app
- The popup approach required `WebviewWindowBuilder` which created a distinct OS window with its own title bar and close button
- Passkey/fingerprint authentication failed in the embedded webview due to WKWebView's lack of WebAuthn entitlements (a platform limitation, documented for follow-up)

## Solution

Leveraged Tauri v2's multi-webview API (behind the `unstable` feature flag) to render Auth0 directly inside the main window as an overlay child webview. Combined with auto-triggering login on mount, users now see the Auth0 login page immediately when the app opens — no buttons, no popups.

## Implementation Details

### Rust: Overlay webview instead of popup (`auth.rs`)

- Replaced `WebviewWindowBuilder` (creates a new OS window) with `WebviewBuilder` + `Window::add_child()` (creates a child webview in the existing window)
- The overlay uses `.auto_resize()` to stay full-window when the user resizes
- Added a `close_auth_overlay` command for programmatic cleanup (emits `auth-cancelled` to settle pending promises)
- Enabled the `unstable` feature on the `tauri` crate to access `WebviewBuilder`, `get_window()`, and `get_webview()`

### TypeScript: Auto-login and initialization state (`AuthProvider.tsx`)

- Added `isInitialized` to `AuthState` — prevents premature login triggers while an expired token is being silently refreshed
- Added a cleanup `useEffect` that calls `close_auth_overlay` when `isAuthenticated` transitions to `true` (handles race between token refresh and overlay login)
- Both `DisabledAuthProvider` (OSS mode) and `PkceAuthProvider` expose the new flag

### TypeScript: Auto-trigger login (`LoginScreen.tsx`)

- Removed the "Sign in with Auth0" button entirely
- The component now auto-triggers `login()` on mount via a `useEffect` with a ref guard
- Renders a minimal spinner (hidden behind the overlay anyway)
- On error, shows the Stigmer branding with the error message and a "Try again" button

### TypeScript: App routing (`App.tsx`)

- Replaced the `isLoading` guard with `isInitialized` to prevent `LoginScreen` from unmounting mid-login (which would reset the auto-trigger ref)
- The spinner now shows during initialization (expired token refresh), not during active login

## Benefits

- **Zero-click login**: App opens → Auth0 appears immediately. No intermediate screen, no extra click.
- **No popup**: Auth renders inside the main window. The app feels cohesive and native.
- **Resilient lifecycle**: Token refresh races, logout re-triggers, and error retries all handled cleanly.
- **Backward-compatible**: The Tauri command name (`open_auth_window`) and event contracts (`auth-callback`, `auth-cancelled`) are preserved — only the implementation changed.

## Impact

- Desktop app users get a streamlined first-launch experience
- The auth flow matches user expectations for a native desktop app (similar to VS Code, Slack)
- Passkey/fingerprint remains a known limitation of WKWebView — documented as a follow-up (ASWebAuthenticationSession or system browser fallback)

## Related Work

- `2026-04-25-124936-desktop-cloud-auth-pkce-deep-link` — Initial PKCE deep link callback implementation
- `2026-04-25-133251-desktop-embedded-auth-webview` — Embedded auth webview and token revocation

---

**Status**: ✅ Production Ready
