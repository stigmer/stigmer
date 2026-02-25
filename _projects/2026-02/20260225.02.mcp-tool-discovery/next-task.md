# Next Task: 20260225.02.mcp-tool-discovery

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260225.02.mcp-tool-discovery

**Description**: Add MCP server tool/resource discovery to Stigmer. CLI uses the Go MCP SDK to connect locally and discover tools/resources, then pushes results to stigmer-server via a new updateDiscoveredCapabilities RPC. Dynamic discovery replaces static seedpack tool lists.
**Goal**: Enable Stigmer to store and expose the list of tools/resources available on each configured MCP server, so agents can make informed decisions about which MCP servers to use.
**Tech Stack**: Protobuf, Go (CLI, stigmer-server, mcp-server codegen), Java (stigmer-cloud), buf generate
**Components**: APIs (proto definitions), stigmer-server (RPC handler), stigmer-cloud (RPC handler with FGA), CLI (discover command), mcp-server (codegen)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-02-25 — Completed Phase 1 + Phase 3 (RPC handlers in Go and Java)
- **Active Task**: Phase 4 next (CLI discovery command)

## Session Progress (2026-02-25)

### Phase 1: Proto Changes + Codegen — COMPLETE

- Extended `McpServerStatus` in `status.proto` with `discovered_capabilities` field (field 3)
- Added 3 new messages: `DiscoveredCapabilities`, `DiscoveredTool`, `DiscoveredResourceTemplate`
- Added `DiscoverySource` enum (seedpack, cli, agent_runner)
- Added `UpdateDiscoveredCapabilitiesInput` to `io.proto`
- Added `updateDiscoveredCapabilities` RPC to `command.proto` with `can_edit` IAM authorization
- Ran `make build` in `apis/` — buf lint passed, all language stubs generated
- Verified all downstream Go modules compile: stubs, stigmer-server, CLI, mcp-server

### Phase 3: Server-Side RPC Handlers (Go + Java) — COMPLETE

**Go (stigmer repo):**
- Created `update_discovered_capabilities.go` in mcpserver controller with custom 4-step pipeline:
  - ValidateProto → LoadMcpServerById → SetDiscoveredCapabilities → PersistMcpServer
- Added `UpdateDiscoveredCapabilities` method to downstream mcpserver client
- Updated BUILD.bazel with new source file and `apiresourcekind` dependency
- All Bazel builds pass: controller, downstream client, server package

**Java (stigmer-cloud repo):**
- Created `McpServerUpdateDiscoveredCapabilitiesHandler.java` extending `CustomOperationHandlerV2<UpdateDiscoveredCapabilitiesInput, McpServer>` with 7-step pipeline:
  - ValidateFieldConstraints → LoadFromRepo → Authorize (FGA can_edit) → SetDiscoveredCapabilities → Persist → TransformResponse → SendResponse
- Updated `McpServerGrpcAutoController.java` with @see reference
- Handler compiles successfully (pre-existing errors in other files unrelated)

### Phase 2: Seedpack — REVISED (deferred to after CLI)

Original plan was static tool lists in seedpack YAML. Decision changed: tools will be discovered dynamically via CLI command (`stigmer discover mcp-server`), not hardcoded. Seedpack YAML stays lean (transport config only). Bootstrap wiring will call CLI discovery after MCP servers are applied.

### Design Decisions Made

1. **`discovered_capabilities` lives in `McpServerStatus`** — Status tracks structural validation + discovered capabilities.

2. **`DiscoverySource` as an enum, not string** — Values: `seedpack`, `cli`, `agent_runner`.

3. **`input_schema` as `google.protobuf.Struct`, not `string`** — Canonical proto representation for arbitrary JSON.

4. **`DiscoveredResourceTemplate` (not `DiscoveredResource`)** — Matches MCP spec's URI template distinction.

5. **Dynamic discovery over static seedpack** — Tools/resources come from the MCP server itself via CLI discovery, not from hardcoded YAML. Single source of truth, auto-updates when tools change.

6. **Custom pipeline steps for Go handler** — `UpdateDiscoveredCapabilitiesInput` doesn't fit standard `LoadTargetStep` (uses `mcp_server_id` not `value`), so custom load/persist steps were needed.

## Next Steps

### Phase 4: CLI Discovery Command

1. Add `stigmer discover mcp-server <org/name>` command
2. Use Go MCP SDK (`v1.3.0`, already indirect dep in `cli/go.mod`) to connect via stdio
3. Call `tools/list` and `resources/templates/list` on the MCP server
4. Convert MCP SDK types to proto types (`DiscoveredTool`, `DiscoveredResourceTemplate`)
5. Push results via `updateDiscoveredCapabilities` RPC

### Phase 5: Bootstrap Integration (after CLI)

1. After bootstrap applies MCP servers from seedpack, run discovery via CLI
2. For each MCP server with stdio config, spawn process, discover, update capabilities
3. Best-effort: log warnings on failure, don't block startup

## Context for Resume

- Proto foundation is solid and all codegen is complete across Go, Java, Python, TypeScript, Dart stubs
- Go RPC handler is fully implemented and compiles — ready to receive calls from CLI
- Java RPC handler is fully implemented with FGA authorization — ready for cloud deployment
- Go downstream client has `UpdateDiscoveredCapabilities` method — ready for bootstrap wiring
- Go MCP SDK (`github.com/modelcontextprotocol/go-sdk v1.3.0`) is already an indirect dependency in `cli/go.mod`
- The seedpack YAML for `stigmer-mcp-server` stays as-is (just transport config, no static tool list)

## Essential Files

### Proto files (Phase 1 output)
- `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` — DiscoveredCapabilities, DiscoveredTool, DiscoveredResourceTemplate, DiscoverySource
- `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` — UpdateDiscoveredCapabilitiesInput
- `apis/ai/stigmer/agentic/mcpserver/v1/command.proto` — updateDiscoveredCapabilities RPC

### Go RPC handler (Phase 3 output)
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/update_discovered_capabilities.go` — custom pipeline handler
- `backend/services/stigmer-server/pkg/downstream/mcpserver/client.go` — downstream client with UpdateDiscoveredCapabilities

### Java RPC handler (Phase 3 output)
- `backend/services/stigmer-service/.../McpServerUpdateDiscoveredCapabilitiesHandler.java` — handler with FGA
- `backend/services/stigmer-service/.../McpServerGrpcAutoController.java` — auto-controller reference

### Key reference files for next phases
- `mcp-server/internal/server/server.go` — the 12 tools and 5 resource templates to discover
- `client-apps/cli/cmd/stigmer/root/` — CLI command directory

### Project documentation
- `_projects/2026-02/20260225.02.mcp-tool-discovery/tasks/T01_0_plan.md` — Full implementation plan

## Quick Commands

After loading context:
- "Continue with Phase 4" — Start CLI discovery command implementation
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
