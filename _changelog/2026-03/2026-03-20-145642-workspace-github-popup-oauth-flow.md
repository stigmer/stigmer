# Workspace GitHub Popup OAuth Flow

**Date**: March 20, 2026

## Summary

Replaced the full-page redirect GitHub OAuth flow in the workspace editor with a popup-based flow that keeps the user on the same page. The GitHub panel now opens by default when the workspace popover is triggered, eliminating an extra click. Together, these changes reduce the session composer workspace setup from 3 steps with context loss to 1 step with seamless inline feedback.

## Problem Statement

The workspace GitHub repo picker required two unnecessary friction points during the "connect GitHub" flow:

### Pain Points

- **Extra click**: Opening the workspace popover showed two source buttons (GitHub Repo / Local Folder). The user had to click "GitHub Repo" before seeing the connection prompt — unnecessary when GitHub is the default and most common source.
- **Full-page context loss**: Clicking "Connect GitHub" triggered `window.location.href = authorizeUrl`, navigating the entire page to GitHub. After authorization, the callback page exchanged the token and redirected to the home page. The user lost their session composer state and had to re-open the workspace popover, re-select GitHub, and continue from scratch.
- **Blank loading page**: During the OAuth callback exchange, the user saw a full-screen "Connecting your GitHub account..." spinner with no other context — a jarring break in their workflow.

## Solution

Two complementary UX improvements, both implemented in the SDK layer (`@stigmer/react`) for reuse by platform builders:

1. **Default GitHub panel**: `WorkspaceEditor` initializes with the GitHub panel open when `enableGitHub` is true, removing the extra click.
2. **Popup OAuth flow**: `useGitHubConnection` now supports `connect(redirectUri, { popup: true })` which opens the GitHub authorization page in a centered popup window instead of redirecting the current page. The callback page detects the popup context, signals the opener via `postMessage`, and closes itself. The opener re-reconciles the token from the server-side personal environment.

## Implementation Details

### `useGitHubConnection` Hook (SDK)

- **New states**: `isConnecting` (popup in progress), `popupBlocked` (browser blocked the popup).
- **`connect()` signature**: Now accepts `options?: { popup?: boolean }`. Default `false` preserves backward compatibility.
- **Popup lifecycle**: Opens a centered 600x700 popup, monitors `popup.closed` via polling interval (500ms), and listens for `message` events from the callback page.
- **Security**: No token data crosses the `postMessage` boundary. The message only carries `{ type: 'stigmer:github:callback-success' }`. The opener re-reads the token from the encrypted personal environment server-side.
- **Re-reconciliation**: On receiving the success message, the hook resets `reconciled.current = false`, refetches the personal environment, and lets the existing reconciliation effect reveal and validate the token.
- **Cleanup**: Popup poll interval is cleared on unmount. `disconnect()` closes any open popup.

### `WorkspaceEditor` Component (SDK)

- **Default panel**: `activePanel` initializes to `"github"` when `enableGitHub` is true.
- **Inline connecting state**: New UI state between "not connected" and "connected" — an inline spinner with "Connecting to GitHub..." shown while `isConnecting` is true.
- **Popup blocked fallback**: When `popupBlocked` is true, shows a message with "Try again" and "Continue with redirect" buttons.

### Callback Page (Console)

- **Popup detection**: `isPopupWindow()` checks `window.opener` on mount.
- **Popup success path**: Sends `postMessage` with the shared constant `GITHUB_CALLBACK_MESSAGE_TYPE` and calls `window.close()` instead of `router.replace("/")`.
- **Popup error path**: Shows the error with "You can close this window and try again" instead of the redirect-to-home button.
- **Non-popup path**: Unchanged — still redirects to home page.

### Barrel Exports

- `GITHUB_CALLBACK_MESSAGE_TYPE` exported from `@stigmer/react` for use by Console callback pages and platform builders implementing custom callbacks.
- `GitHubConnectOptions` type exported for TypeScript consumers.

## Benefits

- **Zero context loss**: The user stays on the session composer page throughout the entire OAuth flow.
- **One fewer click**: GitHub panel is pre-selected, reducing the workspace setup from 3 steps to 1.
- **Inline feedback**: The connecting spinner appears inside the compact GitHub picker panel, not a full-screen takeover.
- **Backward compatible**: The `connect()` function defaults to redirect mode. Existing integrations are unaffected.
- **SDK-first**: All behavior lives in `@stigmer/react`. Platform builders get the same popup OAuth UX by passing `{ popup: true }` to `connect()`.
- **Secure**: No tokens cross the `postMessage` boundary. The popup only signals "done" and the opener re-reads from the encrypted server-side personal environment.

## Impact

- **Direct users**: Session composer GitHub workspace setup is now seamless — no page navigation, no lost state.
- **Platform builders**: `useGitHubConnection` gains popup OAuth support via a single option flag, reusable in any context.
- **Console callback page**: Handles both popup and redirect modes transparently.

## Related Work

- `2026-03-17-141340-github-oauth-workspace-integration.md` — Original GitHub OAuth integration
- `2026-03-19-190727-github-token-migration-to-personal-environment.md` — Token storage migration to personal environment
- `2026-03-20-144540-fix-stale-isloading-on-org-transition.md` — Loading state fix used by this feature

---

**Status**: ✅ Production Ready
