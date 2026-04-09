# MCP Connect Flow: Proto Model, FGA, and Codegen (T01)

**Date**: April 9, 2026

## Summary

Restructured the MCP server proto API to replace the two-step Discover + Generate Policies flow with a single `Connect` RPC. Moved tool approvals from spec to status, introduced `pinned_tool_approvals` for manual overrides, added `can_connect` FGA permission, and regenerated all SDK stubs. This is the foundational layer (T01 of 4) enabling a unified MCP server setup experience.

## Problem Statement

The MCP server onboarding flow required two separate operations: (1) discover capabilities, then (2) generate approval policies via a heavyweight agent session. This led to a confusing UX, unnecessary latency, and a complex authorization surface with multiple RPCs.

### Pain Points

- Two-step setup was unintuitive for users — "Discover" and then "Generate Policies" as separate actions
- `default_tool_approvals` lived in spec (user-facing), mixing system-generated data with user configuration
- `discoverCapabilities` and `updateDiscoveredCapabilities` were two separate RPCs for what is logically one operation
- `DiscoverySource` enum added unnecessary complexity with no real value
- CLI performed local discovery and pushed results back via a separate RPC call

## Solution

Consolidated the flow at the proto/API layer:
1. **Single RPC**: Merged discovery and policy generation into one `connect` RPC
2. **Clean data separation**: System-generated `tool_approvals` in `McpServerStatus`, user overrides in `McpServerSpec.pinned_tool_approvals`
3. **Simplified authorization**: Single `can_connect` permission (viewer-level) replaces the previous multi-permission surface
4. **Backend-delegated discovery**: CLI sends `runtime_env` to the backend, which performs discovery server-side

## Implementation Details

### Proto changes (4 files)
- `spec.proto`: Deleted `default_tool_approvals`, added `pinned_tool_approvals = 11` with documentation for the 4-tier approval policy chain
- `status.proto`: Added `tool_approvals = 4` to `McpServerStatus`, deleted `DiscoverySource` enum and `discovered_by` field from `DiscoveredCapabilities`
- `command.proto`: Deleted `updateDiscoveredCapabilities` RPC, renamed `discoverCapabilities` → `connect` with `can_connect` permission
- `io.proto`: Deleted `UpdateDiscoveredCapabilitiesInput`, renamed `DiscoverCapabilitiesInput` → `ConnectInput` with `runtime_env` field

### IAM + FGA
- Added `can_connect = 22` to `IamPermission` enum
- Added `define can_connect: viewer` to `mcp_server.fga` (stigmer-cloud)

### Codegen
- Regenerated Go, TypeScript, Python, Java stubs via `make protos`
- Regenerated SDK docs via `make gen-proto-sdk-docs` and `make gen-react-sdk-docs`
- Updated JSON schemas for codegen pipeline

### Go backend
- New `connect.go` handler (replaces `discover_capabilities.go` and `update_discovered_capabilities.go`)
- Updated controller, apply, server wiring, and downstream client
- Removed `DiscoverySource` parameter from `mcpdiscovery.Discover()` shared library

### CLI
- Rewrote `discover.go` to call `Connect` RPC with `runtime_env` resolved from local environment
- DryRun mode still uses local `mcpdiscovery.Discover()` for preview

### React SDK (minimal fixes for compilation)
- Renamed `defaultToolApprovals` → `pinnedToolApprovals` in 5 files
- Updated `discoverCapabilities` → `connect` in hook

## Benefits

- **Simpler API surface**: 1 RPC instead of 3, 1 FGA permission instead of multiple
- **Cleaner data model**: System-generated approvals separated from user configuration
- **Net code reduction**: 6207 lines deleted, 3333 inserted (net -2874 lines)
- **Foundation for T02-T04**: Unblocks Python classifier, Java handlers, and React UI redesign

## Impact

- **Proto API**: Breaking changes to `McpServerSpec`, `McpServerStatus`, and `McpServerCommandController` — all downstream consumers need updates
- **SDK stubs**: All 4 language stubs regenerated (Go, TypeScript, Python, Java)
- **CLI**: `stigmer discover` now delegates to backend instead of local discovery
- **127 files changed** across the stigmer OSS monorepo

## Related Work

- T02: Python classifier + connect workflow (agent-runner) — next up
- T03: Java handlers + auth wiring (stigmer-cloud) — unblocked
- T04: React SDK + UI redesign — unblocked

---

**Status**: In Progress (T01 complete, T02-T04 remaining)
**Timeline**: T01 completed in 1 session
