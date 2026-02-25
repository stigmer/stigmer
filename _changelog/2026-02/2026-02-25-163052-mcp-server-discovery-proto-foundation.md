# MCP Server Tool Discovery: Proto Foundation

**Date**: February 25, 2026

## Summary

Added protocol buffer definitions for MCP server tool and resource discovery to the mcpserver/v1 domain. This lays the data-model foundation for Stigmer to store and expose what tools and resource templates each configured MCP server provides, enabling agents to make informed decisions about which MCP servers to use.

## Problem Statement

Stigmer tracks MCP server configurations (how to connect, what env vars are needed) but has no knowledge of what an MCP server actually offers. When an agent needs to decide which MCP server to call, it has no metadata about available tools or resources.

### Pain Points

- Agents cannot reason about MCP server capabilities at planning time
- No way to browse or search tools across MCP servers
- The built-in stigmer-mcp-server's 12 tools and 5 resource templates are undocumented in the data model
- No mechanism for the CLI or agent-runner to report discovered capabilities back to the server

## Solution

Extended the `McpServer` API resource's status with a `discovered_capabilities` field that holds a point-in-time snapshot of tools and resource templates. Added an `updateDiscoveredCapabilities` RPC so the CLI (and future agent-runner) can push discovery results to the server.

## Implementation Details

### Proto Changes (3 files)

**status.proto** — Added to `McpServerStatus`:
- `DiscoveredCapabilities` message with repeated tools, resource templates, timestamp, and discovery source
- `DiscoveredTool` message mapping directly to the MCP protocol's Tool type (name, description, input_schema as `google.protobuf.Struct`)
- `DiscoveredResourceTemplate` message for parameterized URI templates (RFC 6570)
- `DiscoverySource` enum: `seedpack`, `cli`, `agent_runner`
- Updated the McpServerStatus comment block to reflect the new discovery model (previously stated "tool discovery happens at RUNTIME, not here")

**io.proto** — Added `UpdateDiscoveredCapabilitiesInput` with `mcp_server_id` and `discovered_capabilities` (both required via buf.validate)

**command.proto** — Added `updateDiscoveredCapabilities` RPC to `McpServerCommandController` with `can_edit` IAM authorization

### Design Choices

- **`google.protobuf.Struct` for input_schema** over string — enables natural YAML representation in seedpack files and avoids escaped JSON strings
- **`DiscoverySource` as enum** over string — type-safe, prevents typos, enables exhaustive switches
- **`DiscoveredResourceTemplate`** (not `DiscoveredResource`) — matches MCP spec's distinction; forward-compatible for adding static resources later
- **Lowercase enum values** — follows existing codebase pattern (workflow's `ValidationState` already uses short-form values)

### Codegen

- `buf lint` passes with all new definitions
- Go stubs generated to `apis/stubs/go/` — gRPC client, server interface, and handler for the new RPC
- Python stubs generated to `apis/stubs/python/`
- All downstream Go modules compile cleanly: stubs, stigmer-server, CLI, mcp-server

## Benefits

- **For agents**: Will be able to inspect available tools before making MCP server selection decisions
- **For developers**: `stigmer discover mcp-server <name>` (Phase 4) will provide visibility into what any MCP server offers
- **For the platform**: The seedpack can pre-populate capabilities for built-in servers (Phase 2), giving immediate value without manual discovery
- **For extensibility**: The same `updateDiscoveredCapabilities` RPC serves CLI, seedpack bootstrap, and future agent-runner runtime cache

## Impact

- **APIs**: 3 proto files modified, ~100 lines of new proto definitions
- **Generated stubs**: Go and Python stubs regenerated for the mcpserver domain
- **No runtime changes yet**: Server returns "unimplemented" for the new RPC until Phase 3 adds the handler

## Related Work

This is Phase 1 of the MCP Tool Discovery project (20260225.02). Remaining phases:
- Phase 2: Static seedpack for the built-in stigmer-mcp-server (12 tools, 5 resource templates)
- Phase 3: Server-side RPC handler for `updateDiscoveredCapabilities`
- Phase 4: CLI `stigmer discover mcp-server` command using Go MCP SDK

---

**Status**: In Progress (Phase 1 of 4 complete)
