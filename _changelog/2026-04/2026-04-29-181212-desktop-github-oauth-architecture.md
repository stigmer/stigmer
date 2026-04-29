# Desktop GitHub OAuth Architecture Redesign

**Date**: April 29, 2026

## Summary

Fixed the "Popup was blocked by your browser" error in the Stigmer Desktop app's GitHub OAuth flow by redesigning the callback architecture to decouple where the OAuth callback lands from where the flow was initiated. The new architecture routes all GitHub OAuth flows through Stigmer's web console callback page as a routing hub, supporting desktop (via deep link bridge), web console (via popup/postMessage), and platform builder (via popup-close re-reconciliation) environments — all with a single registered GitHub OAuth callback URL.

## Problem Statement

Tauri's Wry webview blocks `window.open()` calls, causing the GitHub OAuth popup flow to fail in the desktop app. The `useGitHubConnection` hook received `null` from `window.open()` and surfaced a "Popup was blocked by your browser" error.

### Pain Points

- Desktop users could not connect GitHub repos to their workspace
- The redirect URI was hardcoded to `window.location.origin`, which only works for the web console
- GitHub OAuth Apps support a single callback URL, preventing localhost callback servers from working in cloud mode
- Cross-origin popup signaling via `postMessage` fails for platform builders embedding Stigmer components
- No reusable callback page component existed in the SDK for platform builders

## Solution

Redesigned the GitHub OAuth flow around the architectural insight that **all five problems trace back to one assumption: the callback always lands on the same origin that initiated the flow.** The fix decouples the two.

All OAuth flows now funnel through Stigmer's web console callback page (`app.stigmer.ai/auth/github/callback`), which acts as a routing hub. The callback page detects how the flow was initiated and delivers the result through the appropriate channel:

- **Web console popup**: Same-origin `postMessage` + `window.close()` (existing behavior, unchanged)
- **Desktop app**: `?source=desktop` query param triggers a `stigmer://github/callback` deep link redirect, passing `code` and `state` back to the Tauri app
- **Platform builders**: Popup-close detection triggers re-reconciliation from the personal environment (no cross-origin signaling needed)

## Implementation Details

### SDK Hook (`useGitHubConnection`)

- Renamed `UseGitHubConnectionConfig.redirectUri` to `callbackUrl` — reflects that this is the callback page URL, not just a redirect parameter
- Added `reconcile()` method to `UseGitHubConnectionReturn` — external trigger for re-reconciliation when the token exchange was handled by another surface
- Added **popup-close re-reconciliation** — when a popup closes, the hook refetches the personal environment. The callback page already exchanged the code and stored the token server-side, so the initiator just needs to pick it up. This is the key change that makes cross-origin platform builder flows work.

### Web Callback Page (Console)

- Added `CallbackRouter` in `page.tsx` that checks `source=desktop` before rendering the existing `GitHubCallbackPageView`
- Added `DesktopGitHubBridge` — a pure redirect component with no auth dependencies. Reads `code` and `state` from query params, redirects to `stigmer://github/callback?code=...&state=...`
- The existing `GitHubCallbackPageView` is completely untouched

### Tauri Deep Link Handler

- Added `stigmer://github/callback` as a second deep link match in `lib.rs` alongside `stigmer://auth/callback`
- Emits `github-callback` Tauri event with code, state, and error fields
- Reuses the existing `AuthCallbackPayload` struct

### Tauri Rust OAuth Servers

- Refactored `start_auth_callback_server` into a shared `start_oauth_callback_server` function with configurable event name and port range
- Added `start_github_callback_server` for local mode (ports 17237–17239)

### Desktop Hook (`useDesktopGitHubConnection`)

Dual-mode based on deployment context:
- **Cloud mode**: Uses `${CONSOLE_URL}/auth/github/callback?source=desktop` as the callback URL. No localhost server. Code+state arrive via the `stigmer://github/callback` deep link.
- **Local mode**: Starts a localhost callback server. GitHub's lenient localhost matching accepts any port. Code+state arrive via the `github-callback` Tauri event from the Rust server.

Both modes share the same event listener and call `handleCallback()` to complete the exchange.

### Environment Configuration

- Added `VITE_STIGMER_CONSOLE_URL` to `.env.production` and `.env.development` (default: `https://app.stigmer.ai`)
- Added TypeScript declarations for all Vite env vars in `vite-env.d.ts`

## Benefits

- Desktop GitHub OAuth works without any GitHub OAuth App configuration changes
- Platform builders can use GitHub OAuth through Stigmer's callback page via popup flow
- Single callback URL serves all environments (web, desktop, embedded)
- SDK remains framework-agnostic — no Tauri or Next.js dependencies in `@stigmer/react`
- No backend or proto changes required

## Impact

- **Desktop users**: Can now connect GitHub repos in workspace (previously blocked)
- **Web console users**: No visible changes; popup-close re-reconciliation is a free reliability improvement
- **Platform builders**: Cross-origin popup flow now works (popup-close triggers re-reconciliation)
- **Deployment**: Web app must be deployed before desktop update ships (the callback page bridge must be live)

## Related Work

- Phase 2 (follow-up): Extract `GitHubCallbackHandler` into `@stigmer/react` for platform builders who host their own callback route
- Phase 3 (future): Per-org OAuth App credentials for full platform builder independence

---

**Status**: In Progress (requires web deployment before desktop release)
**Files Changed**: 12 files across sdk/react, client-apps/web, client-apps/desktop
