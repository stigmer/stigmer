# Fix OAuth Popup for COOP-Enforcing Providers (BroadcastChannel Fallback)

**Date**: April 12, 2026

## Summary

OAuth popup sign-in failed for MCP servers hosted on providers that send `Cross-Origin-Opener-Policy: same-origin` (e.g., Sentry). The browser severed the `window.opener` reference as soon as the popup navigated cross-origin, causing the opener to immediately detect `popup.closed === true` and fire a premature error. Added `BroadcastChannel` as a COOP-resilient fallback communication channel alongside the existing `postMessage` path.

## Problem Statement

When a user clicked "Sign in to connect" for an MCP server like Sentry, the OAuth popup opened and the backend successfully performed Dynamic Client Registration. However, the user saw "The authentication window was closed before completing sign-in" before they even had a chance to authenticate.

### Pain Points

- Sentry's `mcp.sentry.dev` returns `Cross-Origin-Opener-Policy: same-origin` on all responses
- When the popup navigates from `about:blank` to the cross-origin auth URL, the browser performs a browsing context group switch
- The opener's reference to the popup becomes "closed" from JavaScript's perspective, even though the popup is still visible
- The 500ms `popup.closed` polling interval immediately detected this and rejected the OAuth promise
- Any MCP OAuth provider adopting COOP headers (an increasingly common security best practice) would hit this same failure

## Solution

Dual-channel communication: always send the OAuth callback result via both `BroadcastChannel` (COOP-resilient, same-origin, no `window` reference needed) and `window.opener.postMessage` (existing path for non-COOP providers). On the opener side, listen on both channels and add a 5-second grace period before treating `popup.closed` as a real user-initiated close.

## Implementation Details

### OAuthCallbackHandler.tsx (callback/popup side)

- Always broadcasts the `code` + `state` payload via `BroadcastChannel` before attempting `window.opener.postMessage`
- When `window.opener` is `null` (COOP case) but `BroadcastChannel` succeeded, marks status as "done" and closes the popup instead of falling through to the "no-opener" dead end

### useMcpServerOAuthConnect.ts (opener/listener side)

- Added `OAUTH_BROADCAST_CHANNEL` constant (`"stigmer:oauth:broadcast"`)
- Extracted shared `validateAndSettle()` from the `onMessage` handler so both channels share identical validation logic (state match, code presence)
- Opens a `BroadcastChannel` listener alongside the existing `window.message` listener
- Changed `popup.closed` polling: records the first detection timestamp and waits a 5-second grace period (`POPUP_CLOSED_GRACE_MS`) before concluding the user actually closed the window, giving time for the BroadcastChannel message to arrive after the OAuth redirect completes

## Benefits

- Sentry and all other COOP-enforcing OAuth providers now work with the popup flow
- Fully backward-compatible: non-COOP providers still use the faster `postMessage` path
- No backend changes required
- No new dependencies — `BroadcastChannel` is natively supported in all modern browsers

## Impact

- **Users**: OAuth sign-in for MCP servers like Sentry, and any future providers that adopt COOP headers, now completes successfully
- **SDK consumers**: No API changes; the fix is internal to `OAuthCallbackHandler` and `useMcpServerOAuthConnect`
- **Marketplace**: Unblocks public listing of MCP servers that enforce strict security headers

## Related Work

- `2026-04-11-104407-t04-react-sdk-oauth-connect-ui.md` — original OAuth popup UI implementation
- `2026-04-11-132434-fix-oauth-connect-error-simplify-ux.md` — earlier OAuth connect error handling
- `2026-04-12-094541-add-manual-token-override-for-oauth-mcp-servers.md` — manual token fallback (workaround users had to use before this fix)

---

**Status**: ✅ Production Ready
