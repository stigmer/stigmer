# Add Manual Token Override for OAuth MCP Servers

**Date**: April 12, 2026

## Summary

Added a "Enter token manually" escape hatch to OAuth-based MCP servers in `@stigmer/react`, allowing users to bypass the OAuth flow and provide their own access token directly. This unblocks Slack MCP connectivity (and any future vendor-OAuth server) before Marketplace approval is obtained, without requiring any backend, proto, or seedpack changes.

## Problem Statement

The Slack MCP server (`mcp.slack.com/mcp`) requires Slack Marketplace approval before the OAuth flow can work for external workspaces. Until that approval lands — a process that takes weeks — users have no way to connect because the UI only offers the OAuth path when `spec.auth` is present on an MCP server.

### Pain Points

- Users with their own Slack apps and valid user tokens (`xoxp-`) have no way to use them through the UI
- The backend already supports manual token injection via `runtime_env` and personal environment, but the UI never surfaces that option
- The OAuth-only gate blocks all external Slack MCP usage during the Marketplace review period

## Solution

Keep `spec.auth` on the seedpack (preserving OAuth as the primary recommended path) and add a secondary, user-togglable "Enter token manually" option in the UI. When activated, the OAuth-managed `target_env_var` is included in the credential form, and the user can paste their token directly.

The backend resolution order (`runtime_env` > OAuth grant > personal env) means a manually-provided token always wins — no backend changes were needed.

## Implementation Details

All changes are scoped to `@stigmer/react` (SDK package). Zero Console-specific code.

### `useMcpServerCredentials` hook

- Added `manualOverride` boolean state and `setManualOverride` setter to the return type
- When `manualOverride` is `true`:
  - `missingVariables` stops filtering out the OAuth `target_env_var`
  - `isReady` no longer requires an active OAuth grant
- `authMode` derivation stays unchanged — the override is additive, not a replacement

### `McpServerDetailView` (ConnectBar)

- `handleConnectClick` skips the OAuth redirect when `manualOverride` is active
- ConnectBar renders:
  - "Enter token manually" link when in OAuth mode and not connected
  - "Sign in with OAuth instead" link when in manual override mode
  - "Connect" button (instead of "Sign in to connect") in override mode
  - "Entering token manually" as status text

### `McpServerConfigPanel` (session setup popover)

- Added `onSwitchToManual` and `onSwitchToOAuth` optional props
- `InlineOAuthSignIn` renders "Enter token manually" when not connected
- Standalone "Sign in with OAuth instead" link renders in manual mode

### `McpServerPicker` (session MCP setup)

- Added `manualOverrideKeys: Set<string>` local state keyed by server key
- When override is active for a server: OAuth target var filter bypassed, `oauthSignIn` props suppressed, toggle callbacks passed to config panel

## Benefits

- Users can connect to Slack MCP immediately using their own Slack app tokens
- OAuth remains the primary, recommended path — manual entry is a secondary escape hatch
- Platform builders embedding `@stigmer/react` get the override capability automatically
- The "Save for future runs" toggle gives users control over persistence vs one-time use

## Impact

- **Users**: Can now connect to OAuth-based MCP servers (Slack, and any future vendor) without waiting for Marketplace approvals
- **SDK consumers**: `UseMcpServerCredentialsReturn` gains two new fields (`manualOverride`, `setManualOverride`); `McpServerConfigPanelProps` gains two optional props (`onSwitchToManual`, `onSwitchToOAuth`) — all additive, non-breaking
- **Backend**: Zero changes — the existing resolution pipeline handles both paths

## Related Work

- Slack MCP 400 bot token fix (`2026-04-11-225640`)
- OAuth managed env slug collision fix (`2026-04-11-222310`)
- Connect org mismatch grant lookup fix (`2026-04-11-215022`)
- Slack Marketplace submission plan (in progress)

---

**Status**: ✅ Production Ready
