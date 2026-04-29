# Fix GitHub OAuth Popup State Mismatch

**Date**: April 29, 2026

## Summary

Fixed a bug in the popup-based GitHub OAuth flow where the CSRF state parameter was read from the wrong `sessionStorage` context, causing false-positive "OAuth state mismatch" errors. The fix reads the state from the opener window's `sessionStorage` when running inside a popup, preserving CSRF protection while correctly handling cross-window storage isolation.

## Problem Statement

Users clicking "Connect GitHub" in the workspace editor were hitting two sequential issues:

### Pain Points

- **Invalid Redirect URI**: The GitHub OAuth App for workspace repo selection did not have `https://app.stigmer.ai/auth/github/callback` registered as its authorization callback URL. This was a GitHub-side admin configuration issue (not a code bug).
- **OAuth state mismatch after retry**: After fixing the redirect URI, retrying the flow produced a "OAuth state mismatch — possible CSRF attack" error. The popup's `sessionStorage` contained a stale state value from the first failed attempt, while the URL carried the new state from the retry.

## Solution

The `handleCallback` function in `useGitHubConnection` now reads the CSRF state from `window.opener.sessionStorage` when running inside a popup (same-origin), falling back to the local `sessionStorage` for redirect-based flows. After validation, the state is cleaned up from both windows.

## Implementation Details

Two module-level helper functions added to `sdk/react/src/github/useGitHubConnection.ts`:

- **`getSavedOAuthState()`**: Attempts to read the state from `window.opener.sessionStorage` first (popup mode). If the opener is unavailable, closed, or cross-origin, falls back to the current window's `sessionStorage`. This handles both popup and redirect OAuth flows correctly.
- **`clearOAuthState()`**: Removes the state key from both the current window's and the opener's `sessionStorage` (best-effort). Prevents stale state from accumulating across attempts.

The `handleCallback` function was updated to use these helpers instead of directly accessing `sessionStorage`.

## Benefits

- Users can successfully connect GitHub accounts via the popup flow without false CSRF errors
- Retry after a failed OAuth attempt works correctly
- Redirect-based OAuth flow (fallback when popups are blocked) continues to work unchanged
- CSRF protection is preserved — the state is still validated against the trusted source (the window that initiated the flow)

## Impact

- **Users**: Workspace GitHub connection flow works end-to-end in production
- **SDK consumers**: `useGitHubConnection` hook works correctly for platform builders using the popup OAuth mode
- **Files changed**: `sdk/react/src/github/useGitHubConnection.ts` (35 insertions, 2 deletions)

---

**Status**: ✅ Production Ready
