# Next Task: 20260225.02.mcp-tool-discovery

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260225.02.mcp-tool-discovery

**Description**: Add MCP server tool/resource discovery to Stigmer. CLI uses the Go MCP SDK to connect locally and discover tools/resources, then pushes results to stigmer-server via a new updateDiscoveredCapabilities RPC. Static seedpack for built-in servers.
**Goal**: Enable Stigmer to store and expose the list of tools/resources available on each configured MCP server, so agents can make informed decisions about which MCP servers to use.
**Tech Stack**: Protobuf, Go (CLI, stigmer-server, mcp-server codegen), buf generate
**Components**: APIs (proto definitions), stigmer-server (RPC handler, seedpack), CLI (discover command), mcp-server (codegen)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-02-25 — Completed Phase 1 (Proto Changes + Codegen)
- **Active Task**: T01 (Phase 1 complete, Phase 2 next)

## Session Progress (2026-02-25)

### Phase 1: Proto Changes + Codegen — COMPLETE

- Extended `McpServerStatus` in `status.proto` with `discovered_capabilities` field (field 3)
- Added 3 new messages: `DiscoveredCapabilities`, `DiscoveredTool`, `DiscoveredResourceTemplate`
- Added `DiscoverySource` enum (seedpack, cli, agent_runner)
- Added `UpdateDiscoveredCapabilitiesInput` to `io.proto`
- Added `updateDiscoveredCapabilities` RPC to `command.proto` with `can_edit` IAM authorization
- Ran `make build` in `apis/` — buf lint passed, Go + Python stubs generated
- Verified all downstream Go modules compile: stubs, stigmer-server, CLI, mcp-server

### Design Decisions Made

1. **`discovered_capabilities` lives in `McpServerStatus`** — Updated the existing comment (which said "tool discovery happens at RUNTIME, not here") to reflect the new CLI-driven discovery model. Status now tracks two concerns: structural validation + discovered capabilities.

2. **`DiscoverySource` as an enum, not string** — Prevents typos, enables exhaustive switch statements. Values: `seedpack`, `cli`, `agent_runner`.

3. **`input_schema` as `google.protobuf.Struct`, not `string`** — Canonical proto representation for arbitrary JSON. Enables natural YAML in seedpack files (no escaped JSON strings), allows inspection without parsing.

4. **`DiscoveredResourceTemplate` (not `DiscoveredResource`)** — Matches MCP spec's distinction between fixed-URI resources and parameterized URI templates. Forward-compatible: can add static resources later.

5. **Lowercase enum values without prefix** — Matches existing codebase pattern (workflow's `ValidationState` already uses `PENDING`, `VALID`, `INVALID`). Applied to both `ValidationState` and `DiscoverySource`. Zero values keep prefix for uniqueness: `validation_state_unspecified`, `discovery_source_unspecified`.

## Next Steps

### Phase 2: Static Seedpack for Built-in Server

1. Extend `backend/services/stigmer-server/pkg/seedpack/mcp-servers/stigmer-mcp-server.yaml` with `status.discovered_capabilities` containing the 12 tools and 5 resource templates from `mcp-server/internal/server/server.go`
2. Verify the YAML → JSON → protojson pipeline in `seedpack.go` correctly parses the new `status.discovered_capabilities` field (uses `DiscardUnknown: false`)

### Phase 3: Server-Side RPC Handler

1. Create `backend/services/stigmer-server/pkg/domain/mcpserver/controller/update_discovered_capabilities.go`
2. Implement pipeline: validate → load by ID → set discovered_capabilities → set timestamp → persist → return
3. Follow existing patterns from `push.go` (skill controller) for custom RPC with pipeline

### Phase 4: CLI Discovery Command

1. Add `stigmer discover mcp-server <org/name>` command
2. Use Go MCP SDK to connect, list tools, list resource templates
3. Push results via `updateDiscoveredCapabilities` RPC

## Context for Resume

- The proto foundation is solid and all codegen is complete
- The `UnimplementedMcpServerCommandControllerServer` stub returns "unimplemented" for `UpdateDiscoveredCapabilities` — server compiles but the handler doesn't exist yet (Phase 3)
- Go MCP SDK (`github.com/modelcontextprotocol/go-sdk v1.3.0`) is already an indirect dependency in `cli/go.mod`
- The seedpack YAML loader uses `protojson.UnmarshalOptions{DiscardUnknown: false}` — strict parsing, so the YAML must match proto field names exactly (camelCase in JSON)

## Essential Files

### Proto files (Phase 1 output)
- `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` — DiscoveredCapabilities, DiscoveredTool, DiscoveredResourceTemplate, DiscoverySource
- `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` — UpdateDiscoveredCapabilitiesInput
- `apis/ai/stigmer/agentic/mcpserver/v1/command.proto` — updateDiscoveredCapabilities RPC

### Key reference files for next phases
- `backend/services/stigmer-server/pkg/seedpack/mcp-servers/stigmer-mcp-server.yaml` — seedpack YAML to extend
- `backend/services/stigmer-server/pkg/seedpack/seedpack.go` — YAML loader (parseMcpServerYAML)
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/` — controller directory for new handler
- `backend/services/stigmer-server/pkg/domain/skill/controller/push.go` — reference pattern for custom RPC
- `mcp-server/internal/server/server.go` — the 12 tools and 5 resource templates to seed
- `client-apps/cli/cmd/stigmer/root/` — CLI command directory

### Project documentation
- `_projects/2026-02/20260225.02.mcp-tool-discovery/tasks/T01_0_plan.md` — Full implementation plan

## Quick Commands

After loading context:
- "Continue with Phase 2" — Start seedpack YAML extension
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
