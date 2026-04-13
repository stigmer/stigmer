# Frontend: OAuth Disconnect, Connection Health, and Error UX

**Date**: April 13, 2026

## Summary

Implemented the frontend layer for three OAuth gap fixes: a disconnect flow with inline confirmation, a four-state connection health display replacing the binary "Connected" / "Not connected" pill, and enhanced error messages using the SDK's error classification utilities. All changes live in `@stigmer/react` — zero Console dependencies.

## Problem Statement

The existing OAuth UI had three UX gaps identified in the 10-gap analysis:

### Pain Points

- **No disconnect** (GAP 2 frontend): Once connected, users had no way to remove OAuth credentials. Stale grants (e.g., Figma "Connected" mystery) were invisible and irrecoverable without backend intervention.
- **Binary connection status** (GAP 3 frontend): The UI showed "Connected" even when tokens were expired. Users couldn't distinguish a healthy connection from one that needed re-authentication, leading to silent failures during agent execution.
- **Raw error messages** (GAP 9 frontend): OAuth connect failures surfaced raw `error.message` strings that could contain Temporal workflow metadata or gRPC status codes — meaningless to end users with no remediation path.

## Solution

Three layered changes following the SDK's headless-first architecture: a new behavior hook (`useDisconnectOAuth`), enhancements to existing data/orchestrator hooks (`useOAuthGrantStatus`, `useMcpServerCredentials`), and UI updates to both `ConnectBar` (detail view) and `InlineOAuthSignIn` (config panel).

## Implementation Details

### New Hook: `useDisconnectOAuth`

Behavior hook wrapping the `disconnectOAuth` RPC. Follows the established mutation pattern (`useState` + `useCallback` + `toError` + rethrow) matching `useRevokeInvitation` and `useDeleteApiKey`. Returns `{ disconnect, isDisconnecting, error, clearError }`.

### Enhanced Data Layer

- `useOAuthGrantStatus` now returns `connectionHealth: OAuthConnectionHealth` — a direct pass-through from the backend's grant health evaluation (added in T02).
- `useMcpServerCredentials` surfaces `connectionHealth` and a derived `canDisconnect` boolean.

### Health-Aware Status Pill (ConnectBar + InlineOAuthSignIn)

Replaced the binary `isOAuthConnected` ternary with a four-state pill driven by `OAuthConnectionHealth`:

| Health | Color | Label | Detail |
|--------|-------|-------|--------|
| HEALTHY | Green | Connected | Token refresh/expiry info |
| TOKEN_EXPIRED_REFRESHABLE | Amber | Token expired | Will refresh on next use |
| TOKEN_EXPIRED | Red | Re-auth needed | Sign in again to reconnect |
| NO_GRANT | Muted | Not connected | Not connected yet |

Extracted `healthPillProps()` and `inlineHealthProps()` helpers to keep the rendering logic clean instead of deepening ternary nesting.

### Inline Disconnect Confirmation

Follows the established `RevokeConfirmation` pattern from `InvitationManager` — clicking "Disconnect" replaces the ConnectBar content with a confirmation strip: message + destructive "Disconnect" + muted "Cancel". No modal, no portal, no z-index issues for SDK embedders. Local `disconnectPhase` state machine (`idle` → `confirming` → `disconnecting`).

### Enhanced Error Strip

- Replaced `error.message` with `getUserMessage(error)` from `@stigmer/sdk` for human-readable messages.
- Added "Try again" button when `isRetryableError(error)` is true, alongside existing "Dismiss".
- Added `role="alert"` for accessibility.

## Benefits

- **Users can disconnect**: OAuth credentials are removable, resolving stale grant issues.
- **Accurate connection health**: Amber "Token expired" prevents false confidence; red "Re-auth needed" gives clear remediation.
- **Human-readable errors**: No more raw Temporal metadata — users see actionable messages with retry paths.
- **SDK-first**: All changes are in `@stigmer/react` with optional props for backward compatibility. Platform builders get disconnect and health for free.
- **No new primitives**: Reuses existing patterns (inline confirmation, `getUserMessage`, `toError`) — zero new dependencies.

## Impact

- **Direct users**: Better OAuth connection visibility and control in the MCP server detail view.
- **Platform builders**: New `useDisconnectOAuth` hook and enhanced `connectionHealth` on existing hooks — opt-in via new optional props on `McpServerOAuthSignInProps`.
- **Backward compatible**: All new fields/props are additive. `McpServerPicker` and other existing consumers work without changes.

## Related Work

- T01: Proto layer (messages, enums, RPCs) — `OAuthConnectionHealth`, `DisconnectOAuthInput/Output`
- T02: Backend disconnect handler + grant health evaluation
- T03: Backend error message cleanup (Temporal/gRPC)
- T07 (next): Frontend BYOA experience — extends the same components modified here

---

**Status**: Production Ready
**Timeline**: T06 of the OAuth BYOA Integration project (20260413.01)
