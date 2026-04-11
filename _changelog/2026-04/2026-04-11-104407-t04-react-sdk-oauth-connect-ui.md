# T04: React SDK OAuth Connect UI

**Date**: April 11, 2026

## Summary

Added OAuth connect flow, connection status indicators, and auth-aware credential gating to the React SDK (`@stigmer/react`). The MCP server detail view, session setup flow (picker + config panel), and a Console callback route now support popup-based OAuth for servers with `spec.auth` configured. Handles pure OAuth, pure manual, and mixed-mode (OAuth + manual env vars) servers through a single unified flow.

## Problem Statement

T01–T03 built the full OAuth backend: proto definitions, OAuthApp CRUD, DCR+PKCE discovery, authorization code exchange, token storage in personal environments, and pre-flight refresh. But the React SDK and Console had zero OAuth awareness — every MCP server was treated as manual-credential-only.

### Pain Points

- OAuth-enabled MCP servers (9 DCR + 4 vendor) showed the same env var form as manual servers
- Users had to copy-paste OAuth tokens manually instead of one-click sign-in
- No connection status indication for OAuth-authenticated servers
- The session setup flow (`McpServerPicker` / `McpServerConfigPanel`) had no OAuth support
- Platform builders embedding `McpServerDetailView` had no way to offer OAuth to their users

## Solution

SDK-first popup-based OAuth flow with three-layer integration: new action hook, updated credentials hook, and auth-aware UI components across both the detail page and session setup flows.

## Implementation Details

### New Hook: `useMcpServerOAuthConnect`

Action hook that orchestrates the full OAuth popup lifecycle:
1. Opens a blank popup **synchronously** in the click handler (avoids browser popup blockers)
2. Calls `initiateOAuthConnect` RPC to get the authorization URL
3. Navigates the popup to the auth URL
4. Listens for `postMessage` from the callback page (origin-validated, typed protocol)
5. Calls `completeOAuthConnect` to exchange the code for tokens
6. Chains to `connect` for tool discovery

Typed phase state machine: `idle → initiating → awaiting-callback → completing → connecting → done`.
120-second timeout with popup-closed detection. Clear error messages for popup blockers, state mismatches, and timeouts.

### New Component: `OAuthCallbackHandler`

Lightweight component for OAuth callback pages. Extracts `code` and `state` from URL search params, posts them to `window.opener` via `postMessage`, and closes the popup. Handles three scenarios: popup with opener (primary), fallback callback prop (for redirect-mode), and no-opener (instructional message).

### Updated Hook: `useMcpServerCredentials`

Now auth-mode-aware. Returns `authMode` (`"manual" | "oauth"`), `oauthTargetEnvVar`, `isOAuthConnected`, and `tokenLifetimeHint`. Excludes the OAuth-managed env var from `missingVariables` (OAuth manages it, not the form). `isReady` checks ALL vars — both OAuth and manual must be present.

### Updated Component: `McpServerDetailView`

New `OAuthSection` with sign-in button + connection status badge (green dot for connected, gray for not connected). `ConnectBar` shows phase-aware labels during OAuth flow. Mixed mode renders both OAuth section and env var form for remaining non-OAuth vars. `EnvSpecSection` marks the OAuth-managed variable with an "oauth" badge.

### Updated Component: `McpServerConfigPanel`

New `oauthSignIn` prop with `McpServerOAuthSignInProps`. Renders compact inline OAuth sign-in button above the credentials form. Disables tool selector and credential form while OAuth is in progress.

### Updated Component: `McpServerPicker`

Uses `useMcpServerOAuthConnect` internally. Detects `spec.auth` on servers, filters `target_env_var` from the credential form, and wires the OAuth button into the config panel. After OAuth completes, re-adds the server to trigger setup re-evaluation.

### Console Callback Route

New Next.js page at `/auth/oauth/callback` rendering `<OAuthCallbackHandler />`.

## Benefits

- One-click OAuth for 13 MCP servers (9 DCR + 4 vendor) instead of manual token management
- Platform builders get OAuth support automatically by embedding `McpServerDetailView`
- Connection status gives immediate visual feedback on OAuth state
- Mixed-mode support handles servers needing both OAuth and manual configuration
- SDK-first: all logic in `@stigmer/react`, Console page is a 3-line wrapper

## Impact

- **Platform builders**: `McpServerDetailView` and `McpServerConfigPanel` now handle OAuth automatically when `spec.auth` is configured on the server
- **End users**: Visual connection status and one-click sign-in replace manual token entry
- **Session setup flow**: OAuth-enabled servers work inline in the picker without extra steps
- **Public API surface**: 3 new exports (`useMcpServerOAuthConnect`, `OAuthCallbackHandler`, `McpServerAuthMode`) + expanded return types on `useMcpServerCredentials`

## Files Changed

| File | Change |
|------|--------|
| `sdk/react/src/mcp-server/useMcpServerOAuthConnect.ts` | **New** — OAuth popup flow hook |
| `sdk/react/src/mcp-server/OAuthCallbackHandler.tsx` | **New** — Callback page component |
| `client-apps/web/src/app/auth/oauth/callback/page.tsx` | **New** — Console callback route |
| `sdk/react/src/mcp-server/useMcpServerCredentials.ts` | Auth-mode awareness, new return fields |
| `sdk/react/src/mcp-server/McpServerDetailView.tsx` | OAuthSection, connection status, mixed-mode |
| `sdk/react/src/mcp-server/McpServerConfigPanel.tsx` | Inline OAuth sign-in props and UI |
| `sdk/react/src/mcp-server/McpServerPicker.tsx` | OAuth detection and wiring in setup flow |
| `sdk/react/src/mcp-server/index.ts` | Barrel exports |
| `sdk/react/src/index.ts` | Top-level barrel exports |

## Related Work

- T01: `_changelog/2026-04/2026-04-11-084912-oauth-app-proto-definitions-and-mcp-server-auth.md`
- T02: `_changelog/2026-04/2026-04-11-092855-t02-oauthapp-java-handlers-seedpack-auth-blocks.md`
- T02b: `_changelog/2026-04/2026-04-11-095635-t02-oauthapp-go-handlers-stigmer-server-oss.md`
- T03: `_changelog/2026-04/2026-04-11-101803-t03-backend-oauth-connect-flow-token-refresh.md`
- Project: `_projects/2026-04/20260410.03.mcp-oauth-connect/next-task.md`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
