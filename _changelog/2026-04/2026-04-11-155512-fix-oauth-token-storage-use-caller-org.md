# Fix OAuth Token Storage: Use Caller's Org + Auto-Create Personal Environment

**Date**: April 11, 2026

## Summary

Fixed OAuth token storage to use the caller's active organization instead of the MCP server's organization, and added auto-creation of the personal environment when one doesn't exist. This resolves the "Personal environment not found for org 'stigmer'" error when connecting to curated library MCP servers.

## Problem Statement

The `completeOAuthConnect` handler stored OAuth tokens in a personal environment looked up by the MCP server's org. Curated library MCP servers (e.g., `mcp-server-slack`) belong to the `stigmer` org, but users have personal environments in their own orgs (e.g., `suresh`). This mismatch caused all OAuth connects to fail.

### Pain Points

- OAuth connect for any curated library MCP server failed with "Personal environment not found"
- `InitiateOAuthConnectInput` had no `org` field, forcing the backend to derive org from the MCP server
- No auto-creation of personal environments meant users had to manually create one before OAuth would work

## Solution

Added `org` as a required field on `InitiateOAuthConnectInput`. The frontend passes the user's active org (from the org picker/session context). This org flows through the pending OAuth state to `completeOAuthConnect`, which uses it to find or auto-create the personal environment.

## Implementation Details

### Proto (stigmer)
- Added `string org = 2` to `InitiateOAuthConnectInput` in `io.proto`

### Go (stigmer)
- `PendingOAuthState` struct and SQLite schema: added `Org` column with `ALTER TABLE` migration for existing databases
- `initiate_oauth_connect.go`: stores `input.GetOrg()` in pending state
- `complete_oauth_connect.go`: `resolveOrCreatePersonalEnvironmentID` replaces the old method — looks up personal env in the caller's org, auto-creates if missing
- `downstream/environment/client.go`: added `Create` method for auto-creation

### Java (stigmer-cloud)
- `McpServerInitiateOAuthConnectHandler`: reads `context.getRequest().getOrg()` instead of `mcpServer.getMetadata().getOrg()`
- `McpServerCompleteOAuthConnectHandler`: `findOrCreatePersonalEnvironment` with auto-create via `EnvironmentCommandGrpcRepo.createOnBehalfOf`
- `EnvironmentCommandGrpcRepo` + impl: added `createOnBehalfOf` method

### React SDK (stigmer)
- `useMcpServerOAuthConnect`: `startOAuth(mcpServerId, org)` signature
- `McpServerDetailView` and `McpServerPicker`: pass `org` prop to `startOAuth`

## Benefits

- OAuth Connect works for curated library MCP servers regardless of which org they belong to
- Personal environments are auto-created on demand — no manual setup required
- Tokens are stored in the correct org context (the user's active org)
- Backward compatible: if `org` is missing from pending state, falls back to MCP server org

## Impact

- **Users**: OAuth Connect flow unblocked for all curated library MCP servers
- **Platform builders**: SDK consumers pass `org` through the hook, matching the existing pattern used by `useApplyResource`
- **Architecture**: Token storage is now correctly scoped to the user's org, not the resource's org

## Related Work

- `2026-04-11-135420-add-scope-parameter-name-to-oauthapp-spec.md` — Slack scope parameter fix (same session)
- Design decision 001: `_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/001-personal-environment-pattern.md`
- Project: `_projects/2026-04/20260410.03.mcp-oauth-connect/`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
