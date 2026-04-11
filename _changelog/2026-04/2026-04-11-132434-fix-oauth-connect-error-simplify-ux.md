# Fix OAuth Connect Error and Simplify MCP Server Detail UX

**Date**: April 11, 2026

## Summary

Fixed the "OAuth Connect is not configured: stigmer.oauth.redirect-uri is not set" error by wiring OAuth dependencies in the OSS Go server and adding the redirect URI configuration to the Cloud Java service. Simultaneously simplified the MCP server detail view by removing the duplicate Authentication section and elevating the connect action to a top-level Connection section.

## Problem Statement

Clicking "Sign in with mcp-server-slack" on the MCP server detail page failed with a configuration error, and the error displayed in two separate UI locations.

### Pain Points

- **OSS Go server**: `SetOAuthDependencies` was never called in `server.go` — the OAuth grant store, pending state store, and redirect URI were never wired into the `McpServerController`, even though the code, config, and stores all existed.
- **Cloud Java service**: The `stigmer.oauth.redirect-uri` Spring property was referenced via `@Value` in `ExecuteInitiate` but never defined in `application.yaml` or the Kustomize deployment manifests, defaulting to an empty string.
- **Duplicate error display**: Both the `OAuthSection` (Authentication) and `ConnectBar` (Capabilities) rendered `oauth.error`, showing the same error message in two places.
- **Misleading UX hierarchy**: The connect action was buried inside the "Capabilities" section, implying tool discovery was the primary action and connecting was a side effect. In reality, connecting is the user's primary intent; capabilities are the outcome.

## Solution

Three-pronged fix across OSS backend, Cloud backend, and React frontend:

1. Wire OAuth dependencies unconditionally in the OSS Go server (not gated by Temporal)
2. Add the redirect URI configuration to both Cloud config layers (application.yaml + Kustomize)
3. Restructure the detail view to eliminate duplication and promote the connect action

## Implementation Details

### Backend (OSS Go)

- **`server.go`**: After the existing `SetConnectDependencies` block, added unconditional initialization of `PendingOAuthStateStore` and `OAuthGrantStore` using `store.DB()`, then calls `SetOAuthDependencies` with `cfg.OAuthRedirectURI`. Logs a warning when the redirect URI is not set (OAuth Connect disabled) and an info message when it is configured.
- **`README.md`**: Documented `STIGMER_OAUTH_REDIRECT_URI` in the environment variables table.

### Backend (Cloud Java)

- **`application.yaml`**: Added `stigmer.oauth.redirect-uri: ${STIGMER_OAUTH_REDIRECT_URI:}` under the `stigmer:` block.
- **Kustomize `service.yaml`**: Added `STIGMER_OAUTH_REDIRECT_URI` with value `https://app.stigmer.ai/auth/oauth/callback` to the deployment environment variables.

### Frontend (React SDK)

- **Deleted** `OAuthSection` component (~110 lines) and `OAuthConnectionStatusBadge` — the entire duplicate Authentication section.
- **Elevated** `ConnectBar` + credential form out of the Capabilities section into a new top-level `<Section title="Connection">`.
- **Enhanced `ConnectBar`** to absorb OAuth-specific info:
  - Inline OAuth status badge (green "Connected" / muted "Not connected") shown when `authMode === "oauth"`
  - Token lifetime hint displayed when connected ("Tokens refresh automatically · Session lasts ~...")
  - Primary-styled button when OAuth sign-in is needed vs outlined button for reconnect/manual connect
- **Capabilities section** is now purely read-only: just the Tabs (Tools / Policies / Resources) with no connect bar inside.

Net result: 121 insertions, 216 deletions (−95 lines).

## Benefits

- **Error resolved**: MCP OAuth Connect flow works end-to-end once the redirect URI env var is set
- **Single error display**: OAuth errors appear in exactly one location (the Connection section error strip)
- **Clearer hierarchy**: "Connection" is the top-level action; "Capabilities" is the read-only outcome
- **Simpler code**: ~95 fewer lines in the detail view, no duplicate components

## Impact

- **MCP server detail page**: All users see the simplified layout; OAuth servers show inline status in the Connection section
- **OSS deployments**: OAuth Connect for MCP servers now works when `STIGMER_OAUTH_REDIRECT_URI` is set
- **Cloud deployments**: OAuth Connect enabled for production via the Kustomize env var

## Related Work

- [React SDK OAuth Connect UI](./_changelog/2026-04/2026-04-11-104407-t04-react-sdk-oauth-connect-ui.md)
- [Cross-domain repo remediation](./_changelog/2026-04/2026-04-11-121950-mcp-oauth-cross-domain-repo-remediation.md)

---

**Status**: ✅ Production Ready
