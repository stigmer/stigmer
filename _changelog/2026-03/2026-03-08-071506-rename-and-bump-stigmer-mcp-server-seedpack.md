# Rename and Version-Bump Stigmer MCP Server Seedpack

**Date**: March 8, 2026

## Summary

Renamed the built-in Stigmer MCP server seedpack from `stigmer-mcp-server` to `mcp-server-stigmer` and bumped its pinned version from `v0.0.18` to `v0.0.26`. The old version was missing the `McpServerStatus.discovered_capabilities` proto field, causing agent executions (e.g., `stigmer draft mcp-server`) to silently lose discovered tool metadata.

## Problem Statement

The `mcp-server-creator` agent uses the `get_mcp_server` tool to read an MCP server's discovered capabilities and generate approval policies. The seedpack pinned the stigmer MCP server binary at `v0.0.18` — a version whose proto stubs predate the `McpServerStatus` message. That old binary deserialized the backend response using the generic `ApiResourceAuditStatus` type (which only contains `audit`), causing `discovered_capabilities`, `validation_state`, and `validation_message` to be silently dropped as unknown fields during protojson marshaling.

### Pain Points

- `stigmer draft mcp-server` agents could not see discovered tools, blocking approval-policy generation
- The CLI (`stigmer get mcp-server planton -o json`) returned the full 276 KB response including all 100+ discovered tools, while the MCP server tool returned only 3.3 KB — a confusing discrepancy
- The naming convention `stigmer-mcp-server` was inconsistent with the binary name `mcp-server-stigmer`

## Solution

- Bumped the seedpack `go run` target from `@v0.0.18` to `@v0.0.26`
- Renamed `metadata.name` from `stigmer-mcp-server` to `mcp-server-stigmer`
- Updated all slug references in agent seedpacks and tests

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `seedpack/mcp-servers/mcp-server-stigmer.yaml` | Renamed from `stigmer-mcp-server.yaml`; bumped version `v0.0.18` → `v0.0.26`; renamed `metadata.name` |
| `seedpack/agents/mcp-server-creator.yaml` | Updated `mcp_server_ref.slug` |
| `seedpack/agents/agent-creator.yaml` | Updated `mcp_server_ref.slug` |
| `seedpack/seedpack_test.go` | Updated expected file path |
| `client-apps/cli/cmd/stigmer/root/discover.go` | Updated example in CLI help text |

### Root Cause Analysis

The version gap (`v0.0.18` → `v0.0.26`) spans the introduction of `McpServerStatus` with `discovered_capabilities` (field 3), `validation_state` (field 1), and `validation_message` (field 2). The old binary used `ApiResourceAuditStatus` (only field 99: `audit`) for the `McpServer.Status` field. When the backend sent the full status on the wire, the old binary's proto deserializer placed fields 1–3 in the unknown fields bucket, and `protojson.Marshal` with `EmitUnpopulated: false` silently dropped them.

## Benefits

- Agents using `get_mcp_server` now receive the full `McpServerStatus` including `discovered_capabilities`
- The `mcp-server-creator` agent can properly inspect tool metadata for approval-policy generation
- Consistent naming: `mcp-server-stigmer` matches the binary and Go module convention

## Impact

- **Seedpack bootstrap**: Servers initialized with `stigmer server` will get the updated MCP server definition
- **Existing installations**: Require `stigmer server reset` or manual re-apply to pick up the new name and version
- **Agent executions**: `stigmer draft mcp-server` and `stigmer draft agent` will use the updated slug

---

**Status**: ✅ Production Ready
