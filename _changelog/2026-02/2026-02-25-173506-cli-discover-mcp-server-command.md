# CLI `discover mcp-server` Command

**Date**: February 25, 2026

## Summary

Added `stigmer discover mcp-server <ref>` CLI command that connects to an MCP server (via stdio subprocess or HTTP endpoint), queries its tools and resource templates using the MCP protocol, and pushes the discovered capabilities to stigmer-server. This completes Phase 4 of the MCP tool discovery project, enabling dynamic capability discovery as an alternative to static tool lists.

## Problem Statement

When agents need to decide which MCP servers to use, they need to know what tools and resource templates each server provides. Previously, this information would have to be hardcoded in seedpack YAML files, which is fragile, gets stale, and requires manual maintenance every time an MCP server's tool set changes.

### Pain Points

- No way to automatically discover what tools an MCP server provides
- Static tool lists would require manual synchronization with actual server capabilities
- Credentials for third-party MCP servers (e.g., GITHUB_TOKEN) should never leave the developer's machine, ruling out server-side discovery for many cases

## Solution

A new `stigmer discover` top-level CLI verb with an `mcp-server` subcommand. The CLI acts as an MCP client: it fetches the server definition from the backend, spawns or connects to the MCP server locally, calls `tools/list` and `resources/templates/list`, converts the results to proto types, and pushes them via the `updateDiscoveredCapabilities` RPC.

## Implementation Details

Five new files in `internal/cli/mcpserver/` following the CLI coding guidelines (SRP, thin command handler, business logic in internal):

- **discover_transport.go** -- Transport factory supporting both stdio (`CommandTransport` with env var passthrough) and HTTP (`StreamableClientTransport` with header injection via custom RoundTripper)
- **discover_convert.go** -- Pure type conversion from MCP SDK types (`mcp.Tool`, `mcp.ResourceTemplate`) to proto types (`DiscoveredTool`, `DiscoveredResourceTemplate`), including `InputSchema` (`any` -> `structpb.Struct`) with JSON round-trip fallback
- **discover.go** -- Orchestration: fetch server -> create transport -> connect MCP client -> iterate tools/templates with pagination -> convert -> push to backend
- **discover_display.go** -- Terminal output showing server name, transport type, discovered tools with descriptions, resource templates with URI patterns, and push confirmation
- **discover.go (cmd)** -- Thin Cobra command with `--org`, `--timeout`, `--dry-run` flags following the `get`/`list` command pattern

The Go MCP SDK (`v1.3.0`) was promoted from indirect to direct dependency. The `com_github_modelcontextprotocol_go_sdk` Bazel module was added to `MODULE.bazel`.

## Benefits

- **Dynamic discovery**: Tools are queried from the actual MCP server, not from static configuration. The source of truth is the server itself.
- **Credential safety**: Stdio-based discovery runs locally, inheriting the developer's shell environment. Secrets never leave the machine.
- **Both transports**: Supports stdio (spawn subprocess) and HTTP (remote endpoint) MCP servers.
- **Dry-run support**: `--dry-run` flag lets developers preview what would be discovered without modifying backend state.
- **Pagination-safe**: Uses the SDK's iterator API to handle servers with paginated tool/resource lists.

## Impact

- **CLI users**: New `stigmer discover mcp-server <ref>` command available
- **Platform agents**: Can now access tool metadata for informed MCP server selection
- **Bootstrap flow**: Phase 5 will wire this into seedpack bootstrap for automatic discovery on server apply

## Related Work

- Phase 1: Proto definitions for `DiscoveredCapabilities`, `DiscoveredTool`, `DiscoveredResourceTemplate` (commit `c90449d5`)
- Phase 3: Go + Java RPC handlers for `updateDiscoveredCapabilities` (commit `92027569`)
- Phase 5 (next): Bootstrap integration -- auto-discover after seedpack applies MCP servers

---

**Status**: Production Ready
**Timeline**: Phase 4 of MCP Tool Discovery project (20260225.02)
