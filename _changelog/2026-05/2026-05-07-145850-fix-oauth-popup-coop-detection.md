# Fix OAuth Popup COOP Detection for MCP Server Connections

**Date**: May 7, 2026

## Summary

Fixed OAuth sign-in failures for MCP servers whose authorization endpoints set `Cross-Origin-Opener-Policy: same-origin` (notably Sentry, and likely GitHub and other providers). The browser severed the popup's `window.opener` reference, causing a false-positive "authentication window was closed" error within 5 seconds even though the popup was still active.

## Problem Statement

Users clicking "Sign in to connect" on MCP servers with COOP-enabled OAuth endpoints (e.g. `mcp.sentry.dev`) saw the error "The authentication window was closed before completing sign-in" almost immediately, before they had a chance to complete the OAuth flow.

### Pain Points

- OAuth connection to Sentry MCP server was completely broken
- Any MCP server whose OAuth provider sets `Cross-Origin-Opener-Policy: same-origin` was affected
- The existing 5-second grace period was designed for COOP but was far too short for real OAuth flows
- The BroadcastChannel fallback was in place but was preempted by the premature `popup.closed` error

## Solution

Two changes in the React SDK's MCP server OAuth flow:

1. **Conditional popup.closed detection**: When BroadcastChannel is successfully created (all modern browsers), skip the `popup.closed` polling entirely. COOP makes `popup.closed` permanently unreliable for cross-origin OAuth providers; BroadcastChannel is the robust channel that works regardless of COOP. The overall 120-second timeout serves as the safety net for abandoned flows. Legacy browsers without BroadcastChannel retain the existing grace-period behavior.

2. **Cancel sign-in action**: Added a "Cancel sign-in" link visible during the `awaiting-callback` phase. Since `popup.closed` is no longer used to detect manual closes (when BC is available), users need an explicit way to abort the flow. The `clearError` method was enhanced to properly cancel an in-flight OAuth flow: it triggers listener cleanup, closes the popup, and uses a `cancelledRef` guard to prevent the async catch block from re-setting error state after an intentional cancel.

## Implementation Details

### `useMcpServerOAuthConnect.ts`

- Added `hasBroadcastChannel` flag in `waitForOAuthCallback` — set to `true` when BroadcastChannel is successfully constructed
- The `setInterval` poll now short-circuits with `if (hasBroadcastChannel) return`, skipping `popup.closed` checks entirely
- Added `cancelledRef` to the hook for clean cancellation semantics
- Enhanced `clearError` to call `cleanupRef.current?.()` and `closePopup()` when an active flow exists
- Guarded the `startOAuth` catch block with `!cancelledRef.current` to avoid state thrashing after intentional cancellation

### `McpServerDetailView.tsx`

- Added `onCancelOAuth` prop to `ConnectBar`
- Renders a "Cancel sign-in" link (matching existing secondary action styling) when `oauthPhase === "awaiting-callback"`
- Wired to `oauth.clearError` at the call site

## Benefits

- Sentry MCP server OAuth connection now works correctly
- All COOP-enabled OAuth providers (current and future) are handled reliably
- Users have an explicit cancel mechanism during the OAuth popup wait
- Legacy browser behavior is preserved unchanged
- Zero backend changes required

## Impact

- **SDK consumers**: `@stigmer/react` `useMcpServerOAuthConnect` hook and `McpServerDetailView` component
- **End users**: MCP server OAuth sign-in flows that previously failed now complete successfully
- **Backwards compatibility**: No breaking changes — `clearError` gains cancellation behavior only when an active flow exists

## Related Work

- MCP OAuth infrastructure: `McpServerInitiateOAuthConnectHandler`, `McpServerCompleteOAuthConnectHandler` (backend, unchanged)
- `OAuthCallbackHandler` component already handled COOP correctly via BroadcastChannel
- Vendor OAuth seeding migration (`U20260411_SeedVendorOAuthApps`) — Sentry uses DCR path, not vendor OAuth

---

**Status**: Production Ready
