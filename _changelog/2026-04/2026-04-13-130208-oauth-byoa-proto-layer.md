# OAuth BYOA Proto Layer: Messages, RPCs, Enums, and Spec/Status Separation

**Date**: April 13, 2026

## Summary

Defined the complete proto contract layer for OAuth BYOA (Bring Your Own App) integration, including new messages, enums, RPCs, and a binding document pattern. During implementation, identified and corrected a spec/status separation violation, moving all read-only query-time-enriched fields from `McpServerAuth` (spec) to a new `OAuthStatus` sub-message on `McpServerStatus` (status).

## Problem Statement

The MCP server OAuth integration needed foundational proto types to support:
- BYOA: org-level OAuth app overrides with a resolution chain
- Disconnect flow: tearing down user OAuth connections cleanly
- Connection health: reporting token state beyond a binary "connected" boolean

Additionally, the existing `McpServerAuth` message mixed user-declared configuration (spec) with system-derived enrichment (status), violating the Kubernetes-style spec/status separation that is a core architectural invariant of the Stigmer platform.

### Pain Points

- No proto contract for BYOA operations (set/get/delete org OAuth app overrides)
- No proto contract for OAuth disconnect
- No connection health enum — frontend could only show "Connected" or not
- Read-only fields (`vendor_approval_status`, `vendor_approval_docs_url`) placed in spec instead of status
- No `OAuthAppOverride` binding document to map (resource, org) to an OAuthApp

## Solution

### T01 Proto Layer

Defined all new proto types across 5 files in `apis/ai/stigmer/agentic/mcpserver/v1/`:

1. **`oauth.proto`** — Added `OAuthAppOverride` internal binding document (composite key: `resource_id, resource_kind, org_id`)
2. **`io.proto`** — Added `OAuthConnectionHealth` enum, `connection_health` field on `GetOAuthGrantStatusOutput`, and 7 new I/O messages for disconnect + BYOA operations
3. **`command.proto`** — Added 4 new RPCs: `disconnectOAuth`, `setOrgOAuthApp`, `getOrgOAuthApp`, `deleteOrgOAuthApp` with declarative authorization annotations
4. **`status.proto`** — Added `OAuthAppSource` enum, `OAuthStatus` message, and `oauth_status` field on `McpServerStatus`
5. **`spec.proto`** — Cleaned up `McpServerAuth` to contain only user-declared intent; reserved removed field numbers

### Spec/Status Refactoring

Moved 4 read-only fields from `McpServerAuth` to a new `OAuthStatus` sub-message on `McpServerStatus`:
- `vendor_approval_status` — resolved from OAuthApp at query time
- `vendor_approval_docs_url` — resolved from OAuthApp at query time
- `effective_oauth_source` — computed by BYOA resolution chain
- `effective_oauth_app_id` — computed by BYOA resolution chain

Updated all downstream consumers:
- Frontend: `useMcpServerCredentials.ts`, `McpServerPicker.tsx`
- Backend: `McpServerVendorApprovalEnricher.java`

## Implementation Details

### Key Design Decisions

- **Resource-agnostic field naming**: All new RPCs use `resource_id` (not `mcp_server_id`) to match the resource-agnostic `OAuthGrant`/`OAuthAppOverride` data model
- **Authorization model**: Disconnect uses `can_connect` on `mcp_server`; BYOA set/delete use `can_create_oauth_app` on `organization` (org-admin gate); BYOA get uses `can_view` on `mcp_server`
- **Separate binding document**: `OAuthAppOverride` is a binding document (who uses what, where) separate from `OAuthApp` (credential resource), mirroring the established `OAuthGrant` pattern
- **Enum naming**: UPPER_SNAKE_CASE with full prefix (matches `VendorApprovalStatus` convention)

### New Types

| Type | File | Purpose |
|------|------|---------|
| `OAuthAppOverride` | oauth.proto | Binding: (resource, org) → OAuthApp |
| `OAuthConnectionHealth` | io.proto | Token health evaluation enum |
| `OAuthAppSource` | status.proto | Resolution chain result enum |
| `OAuthStatus` | status.proto | System-derived OAuth enrichment |
| `DisconnectOAuthInput/Output` | io.proto | Disconnect flow I/O |
| `SetOrgOAuthAppInput/Output` | io.proto | BYOA set I/O |
| `GetOrgOAuthAppInput/Output` | io.proto | BYOA query I/O |
| `DeleteOrgOAuthAppInput/Output` | io.proto | BYOA delete I/O |

## Benefits

- All downstream tasks (T02-T07) can now proceed with a stable proto contract
- Clean spec/status separation prevents future confusion about which fields are user-declared vs system-derived
- Resource-agnostic design enables future extension to workflows or other resource kinds
- Comprehensive `@internal` documentation on every new type, enum value, and RPC

## Impact

- **Proto**: 5 files modified in `apis/ai/stigmer/agentic/mcpserver/v1/`
- **Stubs**: Regenerated across Go, Java, Python, TypeScript, Dart (both stigmer and stigmer-cloud repos)
- **Frontend**: 2 files updated (vendor approval reads moved to status path)
- **Backend**: 1 file updated (enricher writes to status.oauthStatus)
- **Backward compatibility**: All proto changes are additive; removed fields are reserved

## Related Work

- Part of project `20260413.01.oauth-byoa-integration` (7 tasks, this is T01)
- Unblocks T02 (disconnect + health), T03 (refresh hardening), T04 (BYOA infrastructure) in parallel

---

**Status**: Production Ready
**Timeline**: T01 complete in single session
