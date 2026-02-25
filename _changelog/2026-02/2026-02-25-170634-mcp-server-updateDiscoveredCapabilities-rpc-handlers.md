# MCP Server updateDiscoveredCapabilities RPC Handlers (Go + Java)

**Date**: February 25, 2026

## Summary

Implemented the `updateDiscoveredCapabilities` RPC handler in both Go (stigmer-server, OSS) and Java (stigmer-service, cloud) backends. This enables the CLI and other components to push dynamically discovered MCP server tools and resource templates into the backend, replacing the need for static hardcoded tool lists in seedpack YAML.

## Problem Statement

After Phase 1 established the proto foundation for MCP tool/resource discovery (new messages, RPC, codegen), there was no backend logic to actually handle `updateDiscoveredCapabilities` calls. The gRPC server returned "unimplemented" for this RPC.

### Pain Points

- No way to persist discovered tools/resources for an MCP server
- CLI discovery command (planned) had no backend endpoint to push results to
- Bootstrap wiring and dynamic discovery were blocked on the backend handler

## Solution

Implemented the `updateDiscoveredCapabilities` RPC in both backend services using their respective pipeline frameworks:

- **Go (stigmer-server)**: Custom 4-step pipeline with `ValidateProto`, `LoadMcpServerById`, `SetDiscoveredCapabilities`, and `PersistMcpServer` steps, using the request pipeline framework.
- **Java (stigmer-cloud)**: `CustomOperationHandlerV2` with 7-step pipeline including FGA authorization (`can_edit`), MongoDB persistence, and response transformation.

## Implementation Details

### Go (stigmer OSS)

**New file**: `backend/services/stigmer-server/pkg/domain/mcpserver/controller/update_discovered_capabilities.go`

- Custom pipeline because `UpdateDiscoveredCapabilitiesInput` doesn't fit standard `LoadTargetStep` (uses `mcp_server_id` not embedded resource) or `PersistStep` (input is not the persisted resource).
- Steps: validate input proto constraints → load MCP server from SQLite by ID → set `discovered_capabilities` on status + update audit fields → save back to store.
- Added `UpdateDiscoveredCapabilities` method to the downstream `mcpserver.Client` for internal in-process gRPC calls.
- Updated BUILD.bazel with new source and `apiresourcekind` dependency.

### Java (stigmer-cloud)

**New file**: `backend/services/stigmer-service/.../McpServerUpdateDiscoveredCapabilitiesHandler.java`

- Extends `CustomOperationHandlerV2<UpdateDiscoveredCapabilitiesInput, McpServer>` for non-CRUD RPC handling.
- Pipeline: validate field constraints → load from MongoDB → FGA `can_edit` authorization → set discovered capabilities + audit timestamp → persist → transform → send response.
- Auto-registered via `McpServerGrpcAutoController` (Javadoc `@see` tag added for discoverability).

## Benefits

- **Dynamic discovery ready**: Backend can now receive and persist tool/resource lists from any discovery source (CLI, agent-runner, seedpack)
- **Authorization in cloud**: FGA `can_edit` check ensures only authorized users/services can update MCP server capabilities
- **Consistent patterns**: Both implementations follow established pipeline patterns in their respective codebases
- **Foundation for CLI**: Unblocks Phase 4 (CLI `stigmer discover mcp-server` command)

## Impact

- **Backend developers**: New Go and Java handlers follow existing patterns, easy to maintain
- **CLI users**: Once Phase 4 is complete, users can discover and store MCP server capabilities dynamically
- **Agent runtime**: Agents will be able to query discovered tools/resources to make informed MCP server selection

## Related Work

- Phase 1: Proto + Codegen — `2026-02-25-163052-mcp-server-discovery-proto-foundation.md`
- Phase 4 (next): CLI discovery command implementation
- Phase 5 (future): Bootstrap integration for automatic discovery on startup

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
