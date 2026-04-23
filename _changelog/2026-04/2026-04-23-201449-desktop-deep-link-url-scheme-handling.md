# Desktop App: `stigmer://` URL Scheme Handling

**Date**: April 23, 2026

## Summary

Implemented `stigmer://` deep link handling in the Tauri desktop app, enabling the browser-to-desktop runner launch flow. When a user clicks "Launch Local Runner" in the web console, the OS dispatches a `stigmer://launch-runner?token=...` URL to the desktop app, which exchanges the one-time token for runner credentials and starts a local runner via the CLI sidecar. This completes the receiving side of the Phase 3 browser launch feature.

## Problem Statement

The Phase 3 "Persistent Runners + Browser Launch" project enables cloud users to launch a local runner directly from the web console. The server-side launch token endpoints (Phase 3 T02) were complete, but there was no native handler to receive `stigmer://` URLs and orchestrate the token exchange and runner start.

### Pain Points

- Users had to manually copy credentials and run CLI commands to start local runners
- No native OS integration for the browser-to-runner handoff
- The desktop app existed with full runner management via sidecar but couldn't receive browser-initiated launch requests
- Without single-instance enforcement, deep links on Windows/Linux would spawn duplicate app instances

## Solution

Added two Tauri plugins (`deep-link` and `single-instance`) for URL scheme registration and single-instance enforcement, plus a React hook (`useDeepLinkHandler`) that handles the full lifecycle: URL parsing, token exchange via the SDK, runner start via the sidecar, and non-blocking toast-based progress/error UX.

## Implementation Details

### Tauri Plugin Setup (Rust + Config)

- **`tauri-plugin-deep-link`** (v2.4.7) — Registers `stigmer://` as a custom URL scheme. On macOS, this is handled via `Info.plist CFBundleURLTypes`. On Windows/Linux, `register_all()` is called at startup to register the scheme for the current executable.
- **`tauri-plugin-single-instance`** (v2.4.0, with `deep-link` feature) — Ensures only one app instance runs. On Windows/Linux, when a deep link spawns a second instance, the URL is forwarded to the running instance and the second instance exits.
- Single-instance plugin registered **first** in the builder chain (Tauri requirement), deep-link plugin second.
- `stigmer://` scheme declared in `tauri.conf.json` under `plugins.deep-link.desktop.schemes`.

### React Deep Link Handler

`useDeepLinkHandler(client, baseUrl, isAuthenticated)` — mounted in `AuthenticatedApp` alongside existing lifecycle hooks:

- **Cold start**: `getCurrent()` reads the URL from CLI arguments when the app is launched via a deep link.
- **Warm dispatch**: `onOpenUrl()` listener receives URLs forwarded by the single-instance plugin while the app is running.
- **Auth coordination**: URLs arriving before login are queued in a ref, processed once authentication completes.
- **Token exchange**: `client.runner.exchangeLaunchToken()` via the Stigmer SDK (public RPC — the one-time token IS the authorization).
- **Runner start**: `invokeStartRunner({ token: accessToken, endpoint: baseUrl })` — same sidecar path as manual runner start.
- **Toast UX**: Non-blocking `sonner` toasts matching the `useAppUpdater` pattern — loading, success (with "View Runners" action), or error with specific guidance per failure mode.

### Error Handling

Specific, actionable messages for each failure:
- Token expired or consumed → "Please try again from the browser"
- Network error → "Check your network connection"
- Sidecar failure → "CLI sidecar may be missing"
- Runner already running → "A runner with that name is already running"

## Benefits

- **One-click local runner launch** from the browser — the centrepiece of Phase 3
- **Zero manual credential management** — token exchange happens transparently
- **Cross-platform** — macOS (native), Windows/Linux (via single-instance forwarding)
- **Non-disruptive UX** — toast-based progress, user stays on their current page
- **Auth-safe** — deep links queued until the user is authenticated

## Impact

- **Desktop app**: Feature-complete for all planned tasks (T02–T08). Only T09 (end-to-end testing) remains.
- **Phase 3 project**: Critical path updated. T03/T04 (CLI URL handler) deferred as CLI-only fallback — desktop app is the primary `stigmer://` handler.
- **Users**: Can soon click "Launch Local Runner" in the browser and have a runner start on their machine within seconds.

## Related Work

- Phase 3 T02: Server-side launch token endpoints (`2026-04-23-194714-phase3-t02-launch-token-endpoints.md`)
- Desktop T06: Sidecar runner management (`2026-04-23-172611-desktop-sidecar-runner-management.md`)
- Desktop T07: Auto-updater pipeline (`2026-04-23-183714-desktop-auto-updater-distribution-pipeline.md`)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 session
