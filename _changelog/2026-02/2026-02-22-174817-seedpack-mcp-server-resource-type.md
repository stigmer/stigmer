# Seedpack: Add MCP Server Resource Type

**Date**: February 22, 2026

## Summary

Added MCP server as a first-class resource type in the seedpack package, enabling MCP server definitions to be embedded in the binary and bootstrapped on server startup. The built-in `stigmer-mcp-server` is the first entry, configured to expose all Stigmer resources to MCP clients via STDIO transport.

## Problem Statement

The seedpack already supported two resource types -- skills (ZIP artifacts) and system agents (YAML definitions) -- but had no mechanism for bundling MCP server definitions. With the `stigmer mcp-server` command already functional, we needed a way to register the built-in MCP server as a bootstrap resource so it's automatically available when the server starts.

### Pain Points

- No MCP server resources bootstrapped from the seedpack
- Users had to manually configure the built-in MCP server
- The seedpack pattern for agents existed but wasn't extended to MCP servers

## Solution

Extended the seedpack package with a third resource type following the exact same pattern as system agents: a manifest entry, an embedded YAML definition, Go loader functions, and test coverage. The MCP server YAML follows the `McpServer` proto schema from `api.proto`.

## Implementation Details

- **Manifest** (`manifest.json`): Bumped schema_version to `"3"`, version to `"1.2.0"`, added `mcp_servers` array
- **YAML definition** (`mcp-servers/stigmer-mcp-server.yaml`): Proto-compliant `McpServer` resource with STDIO transport (`stigmer mcp-server`)
- **Go types** (`seedpack.go`): Added `McpServerEntry` struct, `Manifest.McpServers` field, `LoadMcpServerYAML()`, `parseMcpServerYAML()`, `GetMcpServerByName()`
- **Embed** (`embed.go`): Added `//go:embed mcp-servers/*` directive
- **Build** (`BUILD.bazel`): Added `mcp-servers/**` glob and `mcpserver` proto dependency
- **Tests** (`seedpack_test.go`): Added `TestLoadManifest_McpServerEntry`, `TestLoadMcpServerYAML`, `TestGetMcpServerByName`, updated `TestLoadManifest` assertions

Design decision: wrote `parseMcpServerYAML` mirroring `parseAgentYAML` rather than introducing generics. With only two resource types using this pattern, a generic `parseResourceYAML[T]` would be premature abstraction.

## Benefits

- MCP server definitions are now embedded in the binary alongside skills and agents
- Bootstrap process can apply MCP server resources on startup (Phase 2)
- Consistent pattern: MCP servers follow the same manifest + YAML + loader convention as agents
- Full test coverage for the new resource type

## Impact

- **Seedpack package**: New resource type, schema version bump
- **Bootstrap tests**: Version assertion updated to match new seedpack version
- **Future phases**: Enables Phase 2 (bootstrap integration), Phase 3 (server wiring), Phase 4 (daemon auto-start)

## Related Work

- Seedpack infrastructure: `2026-02-08-122424-seedpack-infrastructure-phase-1.md`
- Seedpack bootstrap state machine: `2026-02-08-135010-seedpack-bootstrap-state-machine.md`
- MCP server scaffolding: `2026-02-18-124027-mcp-server-stigmer-scaffolding.md`

---

**Status**: In Progress (Phase 1 of 5 complete)
**Timeline**: Phase 1 completed in one session
