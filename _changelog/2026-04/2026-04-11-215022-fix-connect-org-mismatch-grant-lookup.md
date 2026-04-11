# Fix Connect Org Mismatch in OAuth Grant Lookup

**Date**: April 11, 2026

## Summary

Fixed a systemic org mismatch that prevented OAuth-authenticated MCP servers from connecting. The OAuthGrant was stored under the user's active org (e.g., "suresh") but the connect handler looked it up using the MCP server's metadata org (e.g., "stigmer"). Added a required `org` field to `ConnectInput` so the caller's org context flows through the entire credential resolution chain.

## Problem Statement

After successfully completing the OAuth flow for Slack (tokens stored in a managed environment), the subsequent `connect` RPC failed with `401 Unauthorized` from `mcp.slack.com`. The `SLACK_ACCESS_TOKEN` was never injected into the ExecutionContext despite existing in the managed environment.

### Pain Points

- The grant composite key `(identityAccountId, resourceId, orgId)` never matched because the connect handler used a different org than the one used during OAuth storage
- For public MCP servers (owned by `stigmer` org) used by users in their own org (e.g., `suresh`), the mismatch was guaranteed
- The same org mismatch existed in three separate code paths: connect, pre-flight refresh, and session injection
- When credential resolution returned empty, the handler silently started a Temporal workflow with no environment variables, producing a cryptic 401 instead of a clear error

## Solution

Added `org` as a required field on `ConnectInput`, enforced with `min_len = 1` validation (no fallback to the server's org). All three credential resolution paths now use the caller-provided org for grant lookup.

## Implementation Details

### Proto

- Added `string org = 3` to `ConnectInput` in `io.proto` with required validation
- Ran codegen across Go, Java, Python, TypeScript, and Dart stubs

### Java (stigmer-cloud)

- `McpServerConnectHandler.ExecuteConnectWorkflow`: reads `org` from `context.getRequest().getOrg()` instead of `mcpServer.getMetadata().getOrg()`; passes it through `resolveEnvironmentVariables()`, `resolveOAuthVarsFromManagedEnv()`, `resolveFromPersonalEnvironment()`, and `createExecutionContext()`
- `McpServerConnectHandler.RefreshOAuthToken`: passes request org to the refresh service
- `OAuthTokenRefreshService.refreshIfExpired()`: accepts `org` as a third parameter instead of deriving from server metadata
- `CreateExecutionContextStep.injectMcpOAuthFromManagedEnvironment()`: uses `executionOrg` (user's org) instead of `serverOrg` (MCP server reference org) for grant lookup and refresh
- Added fail-fast guard: returns `FAILED_PRECONDITION` when env resolution is empty but the server has env declarations, preventing a doomed workflow start

### Go (stigmer-server)

- `Connect()`: validates `input.GetOrg()` is non-empty, passes `callerOrg` to all downstream methods
- `refreshOAuthTokenIfNeeded()`: accepts `callerOrg` parameter
- `createConnectExecutionContext()`: accepts `callerOrg`, uses it for grant lookup, personal env resolution, and EC metadata

### SDK (React)

- `useMcpServerConnect`: added `org: string` as required second parameter to `connect()`
- `useMcpServerOAuthConnect`: passes `org` in the chained `ConnectInput` after OAuth complete
- `McpServerDetailView`: all three `connection.connect()` call sites pass `activeOrg ?? org`

## Benefits

- OAuth-authenticated MCP servers (Slack, GitHub, Salesforce, etc.) can now connect when the server's org differs from the user's org
- Missing credentials produce an immediate `FAILED_PRECONDITION` error instead of starting a Temporal workflow that fails with a cryptic 401
- The org used for grant storage and grant lookup are guaranteed to match because both flow from the same caller-provided value
- Session execution also benefits: `CreateExecutionContextStep` uses `executionOrg` for grant lookup

## Impact

- **MCP Connect**: All OAuth-based connect flows for public servers are unblocked
- **Session Execution**: Agent runs that reference public OAuth-connected MCP servers correctly inject tokens
- **Error Clarity**: Empty credential resolution fails fast with an actionable message
- **Proto contract**: `ConnectInput.org` is additive (field 3, defaults to empty string for older clients) but enforced via `buf.validate`

## Related Work

- `2026-04-11-210620-fix-mcp-connect-401-and-delete-handler-pipeline` — Fixed identity account ID and SDK var injection; this change fixes the remaining org mismatch
- `20260411.01.mcp-oauth-managed-credentials` — Separated OAuth tokens into managed environments (the tokens are stored correctly; this fix ensures they can be found)

---

**Status**: ✅ Production Ready
**Repositories**: stigmer (proto + Go + SDK, 21 files), stigmer-cloud (Java, 3 files + stubs)
