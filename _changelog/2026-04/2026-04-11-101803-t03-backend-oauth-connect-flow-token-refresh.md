# T03: Backend OAuth Connect Flow + Token Refresh

**Date**: April 11, 2026

## Summary

Implemented the complete backend OAuth Connect flow for MCP servers across both Go (OSS) and Java (Cloud) backends. Two new RPCs (`initiateOAuthConnect`, `completeOAuthConnect`) enable a frontend-mediated OAuth authorization code flow with PKCE, supporting both MCP-native DCR servers and vendor OAuth servers. Includes OAuth infrastructure (discovery, DCR, PKCE, token exchange), OAuthGrant/PendingOAuthState storage, and pre-flight token refresh integrated into the existing Connect pipeline.

## Problem Statement

MCP servers that require OAuth authentication (13 of the curated 37) had no automated credential acquisition path. Users had to manually obtain tokens from each vendor and paste them into the personal environment. This friction blocked one-click Connect for OAuth-enabled servers.

### Pain Points

- No OAuth flow in the platform — users must manually register apps and exchange codes
- No token refresh — expired tokens cause silent Connect failures
- No DCR support — MCP servers implementing the MCP Authorization spec cannot be used
- No OAuthGrant tracking — no way to know when tokens expire or need refreshing

## Solution

Frontend-mediated (SPA) OAuth pattern with two RPCs, matching the existing GitHub OAuth pattern. The backend handles all OAuth complexity (discovery, DCR, PKCE, token exchange, storage, refresh) while the frontend only manages the browser redirect.

## Implementation Details

### New Proto Messages + RPCs
- `InitiateOAuthConnectInput/Output` and `CompleteOAuthConnectInput/Output` in `io.proto`
- `initiateOAuthConnect` and `completeOAuthConnect` RPCs in `command.proto`
- Both use `can_connect` permission on `mcp_server` resource
- Stubs regenerated in Go, Java, Python, TypeScript, Dart via `make codegen` / `make protos`

### OAuth Infrastructure (Go + Java, 12 new files)
- **PKCE**: S256 code_verifier/code_challenge generation (32-byte random, SHA-256)
- **Discovery**: RFC 8414 `.well-known/oauth-authorization-server` metadata fetching with S256 validation
- **DCR**: RFC 7591 Dynamic Client Registration for public clients (token_endpoint_auth_method: "none")
- **Token**: Authorization code exchange with PKCE + refresh token exchange
- **Refresh**: Reusable `RefreshTokenIfExpired` utility with 60-second pre-expiry buffer

### Storage (Go SQLite + Java MongoDB)
- **OAuthGrant**: Keyed by (identity_account_id, mcp_server_id). Non-secret metadata: expiry, client_id, token_endpoint, env var names. SQLite UPSERT / MongoDB upsert.
- **PendingOAuthState**: Ephemeral state between initiate and complete. PKCE code_verifier, client credentials, token endpoint. 10-minute TTL. Atomic GetAndDelete.

### InitiateOAuthConnect Handler
- DCR path: discover → register client → generate PKCE → build auth URL → store pending state
- Vendor OAuth path: load OAuthApp → decrypt client_secret → generate PKCE → build auth URL → store pending state
- Validates DCR requires HTTP transport (stdio servers with DCR auth = FAILED_PRECONDITION)
- Deployment config: `STIGMER_OAUTH_REDIRECT_URI` environment variable

### CompleteOAuthConnect Handler
- Atomically consumes PendingOAuthState by state parameter
- Exchanges authorization code with PKCE code_verifier
- Stores access_token in personal env as `target_env_var` (secret, encrypted)
- Stores refresh_token as `{target_env_var}_REFRESH_TOKEN` (secret, encrypted)
- Creates OAuthGrant record with expiry and non-secret metadata
- Added `UpdateVariables` write method to Go environment downstream client

### Pre-flight Token Refresh
- Go: `refreshOAuthTokenIfNeeded` in `connect.go` before env resolution
- Java: `OAuthTokenRefreshService` + `RefreshOAuthToken` pipeline step in `McpServerConnectHandler`
- Checks OAuthGrant.access_token_expires_at with 60s buffer
- Reads refresh_token from personal env, calls token endpoint, updates env + grant
- Clear error on refresh failure: "re-authenticate via OAuth Connect"

## Benefits

- OAuth-enabled MCP servers can now be connected with two backend RPCs + a browser redirect
- Pre-flight refresh ensures tokens are always fresh before Connect or Agent Execution
- DCR support enables automatic client registration with MCP Authorization spec servers
- Per-user DCR: each user gets their own client_id, no shared state coordination
- Same architecture in both Go (OSS) and Java (Cloud) backends

## Impact

- **stigmer (Go)**: 9 new files, 4 modified files (controller, config, env client, connect.go)
- **stigmer-cloud (Java)**: 11 new files, 1 modified file (McpServerConnectHandler)
- **Protos**: 2 modified files (io.proto, command.proto), stubs regenerated in all languages
- **No breaking changes**: purely additive surface — existing Connect flow unchanged

## Related Work

- [T01: OAuthApp Proto Definitions](2026-04-11-084912-oauth-app-proto-definitions-and-mcp-server-auth.md)
- [McpServerAuth Flattening](2026-04-11-091131-flatten-mcp-server-auth-remove-oneof-wrapper.md)
- [T02: Java Handlers + Seedpack](2026-04-11-092855-t02-oauthapp-java-handlers-seedpack-auth-blocks.md)
- [T02b: Go Handlers](2026-04-11-095635-t02-oauthapp-go-handlers-stigmer-server-oss.md)
- T04 (next): UI Updates + Token Lifecycle

---

**Status**: Production Ready
**Timeline**: Single session, implementing the planned 6 sub-tasks (T03.1-T03.6)
