# Generalize OAuthGrant to Resource-Agnostic Data Model

**Date**: April 11, 2026

## Summary

Generalized the OAuthGrant infrastructure record from MCP-server-specific to resource-agnostic, enabling future reuse for workflows and other API resource kinds that need OAuth credentials. Renamed `mcp_server_id` to `resource_id`, added `resource_kind` and `org_id` fields, and introduced the `getOAuthGrantStatus` RPC for clean frontend OAuth state detection.

## Problem Statement

The OAuthGrant record was hardcoded to MCP servers via its `mcp_server_id` field and two-part key `(identity_account_id, mcp_server_id)`. This created three issues:

### Pain Points

- **MCP-only coupling**: OAuth is a protocol, not an MCP concept. Workflows and other resource types may need OAuth credentials in the future, but the data model forced MCP-specific semantics.
- **Missing org scoping**: A user could have different OAuth connections for the same shared resource across orgs, but the two-part key had no org dimension.
- **Frontend inference**: The frontend checked personal environment key presence to infer OAuth status — fragile and architecturally wrong. No purpose-built query existed.

## Solution

Renamed the OAuthGrant key from `(identity_account_id, mcp_server_id)` to `(identity_account_id, resource_id, org_id)` and added a `resource_kind` attribute for query filtering. Added a `getOAuthGrantStatus` RPC for clean frontend status queries. All changes span protos, Go (stigmer-server), and Java (stigmer-cloud).

## Implementation Details

### Proto Layer
- **oauth.proto**: `mcp_server_id` (field 2) renamed to `resource_id`. New fields: `resource_kind` (field 10), `org_id` (field 11). Comments updated for managed environment and resource-agnostic language.
- **io.proto**: New `GetOAuthGrantStatusInput` (resource_id + org) and `GetOAuthGrantStatusOutput` (connected, expires_at, target_env_var, auth_method).
- **command.proto**: New `getOAuthGrantStatus` RPC on `McpServerCommandController` with `can_view` permission.

### Go Backend (stigmer-server)
- **grant_store.go**: Struct fields renamed, SQLite table DDL updated with three-part PK. Methods renamed to `Find`/`Delete` with `(identityAccountID, resourceID, orgID)` parameters.
- **refresh.go**, **complete_oauth_connect.go**, **connect.go**: All callers updated to use new field names and method signatures. Grant construction now sets `ResourceKind = "mcp_server"` and `OrgID`.

### Java Backend (stigmer-cloud)
- **OAuthGrantDocument.java**: `mcpServerId` → `resourceId`, added `resourceKind`, `orgId`.
- **OAuthGrantRepo.java**: MongoDB queries updated to three-part key. Methods renamed to `find`/`delete`.
- **McpServerCompleteOAuthConnectHandler.java**, **OAuthTokenRefreshService.java**: Callers updated.

### Stub Regeneration
- All language stubs (Go, Java, Python, TypeScript, Dart) regenerated via `make codegen` and `make protos`.

## Benefits

- **Future-proof data model**: When workflows or other resource types need OAuth, the grant schema is ready — no migration needed.
- **Org-scoped grants**: Same user can maintain separate OAuth tokens per org for shared resources.
- **Clean frontend signal**: `getOAuthGrantStatus` RPC replaces fragile env-key-presence checks.
- **Zero breakage**: No users, no production data — clean rename with no migration overhead.

## Impact

- **Proto API surface**: 3 files changed, 2 new message types, 1 new RPC
- **Go backend**: 4 files changed (grant store, refresh, connect, complete)
- **Java backend**: 4 files changed (document, repo, complete handler, refresh service)
- **Generated stubs**: ~40 files regenerated across Go, Java, Python, TypeScript, Dart
- **Build verification**: Both repos compile cleanly (Go `go build`, Java `bazel build`)

## Related Work

- Predecessor: `_projects/2026-04/20260410.03.mcp-oauth-connect/` — OAuth connect/refresh flows
- Next: T02 (ManagedEnvironmentService), T03 (Connect/Refresh rewiring), T04 (Frontend)

---

**Status**: ✅ Production Ready (T01 complete, part of larger managed credentials project)
**Timeline**: Single session
