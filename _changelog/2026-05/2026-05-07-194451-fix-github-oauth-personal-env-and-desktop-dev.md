# Fix GitHub OAuth Personal Environment Persistence and Desktop Dev Flow

**Date**: May 7, 2026

## Summary

Fixed three issues in the GitHub OAuth connection flow: (1) reconnecting GitHub did not update the token in the personal environment, (2) the desktop app's GitHub OAuth flow failed in dev mode because deep links route to the production `.app` bundle, and (3) the "Connecting to GitHub..." spinner had no cancel or timeout UX.

## Problem Statement

When a user connects their GitHub account via OAuth, the access token should be persisted to the server-side personal environment so it survives page reloads and is available across sessions. Two bugs prevented reliable persistence, and the desktop dev experience was broken.

### Pain Points

- Reconnecting GitHub (disconnect + reconnect, or re-auth with new scopes) silently kept the old token because `addVariables` was skipped when the key already existed
- The desktop app running via `make desktop-dev` could not complete GitHub OAuth — the `stigmer://` deep link routed to the installed production `.app` instead of the dev instance, leaving an infinite "Connecting to GitHub..." spinner
- No way to cancel the connecting state or understand if something went wrong — users were stuck on an infinite spinner with no feedback

## Solution

### Token persistence fix (SDK)

Changed `handleCallback` in `useGitHubConnection` to always call `getOrCreate()` (without initial data) followed by `addVariables(tokenVar)`. The `updateVariables` backend API is a merge operation that overwrites existing keys, so this correctly handles both first-time connection and reconnection.

### Desktop dev mode fix

Added `import.meta.env.DEV` detection to `useDesktopGitHubConnection` so the localhost callback server is used in dev mode even when the deployment mode is "cloud". This mirrors the existing Auth0 flow pattern in `AuthProvider.tsx` where dev mode always uses the localhost server to avoid deep link routing issues.

### Connecting state UX

Extracted the connecting spinner into a `GitHubConnectingState` component with a Cancel button (calls `disconnect()` to reset state) and a 30-second timeout that changes the message to "Taking longer than expected..." to signal a possible issue.

## Impact

- **Web users**: GitHub token now reliably persists across reconnections
- **Desktop developers**: `make desktop-dev` GitHub OAuth flow works without workarounds
- **All users**: Can cancel a stuck GitHub connection flow instead of navigating away

---

**Status**: Production Ready
**Files Changed**: 3 files across sdk/react, client-apps/desktop
