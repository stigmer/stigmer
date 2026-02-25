# Next Task: 20260225.02.mcp-tool-discovery

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260225.02.mcp-tool-discovery

**Description**: Add MCP server tool/resource discovery to Stigmer. CLI uses the Go MCP SDK to connect locally and discover tools/resources, then pushes results to stigmer-server via a new updateDiscoveredCapabilities RPC. Dynamic discovery replaces static seedpack tool lists.
**Goal**: Enable Stigmer to store and expose the list of tools/resources available on each configured MCP server, so agents can make informed decisions about which MCP servers to use.
**Tech Stack**: Protobuf, Go (CLI, stigmer-server, mcp-server codegen), Java (stigmer-cloud), buf generate
**Components**: APIs (proto definitions), stigmer-server (RPC handler), stigmer-cloud (RPC handler with FGA), CLI (discover command, bootstrap discovery), mcp-server (codegen), shared library (mcpdiscovery)

## Current State

- **Status**: In Progress — Phase 5 Complete, ready for end-to-end testing
- **Last Session**: 2026-02-25 — Completed Phase 5 (Bootstrap discovery integration)
- **Active Task**: End-to-end testing and iteration

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

### Phase 4: CLI Discovery Command — COMPLETE

**New command**: `stigmer discover mcp-server <ref> [--org <org>] [--timeout 30s] [--dry-run]`

**Files created (5 new files in `internal/cli/mcpserver/`):**
- `discover_transport.go` → moved to shared library in Phase 5
- `discover_convert.go` → moved to shared library in Phase 5
- `discover.go` — Orchestration: fetch server → delegate to shared library → push via RPC
- `discover_display.go` — Terminal output (unchanged)
- `discover.go` (cmd) — Thin Cobra command in `cmd/stigmer/root/`

### Phase 5: Bootstrap Discovery Integration — COMPLETE

**Shared library** (`backend/libs/go/mcpdiscovery/`) — 3 new files:
- `transport.go` — Transport factory with `CreateTransport(spec, envOverrides)`. Accepts env override slices merged on top of `os.Environ()` via `mergeEnv`.
- `convert.go` — `ConvertTools` and `ConvertResourceTemplates` map MCP SDK types to proto types.
- `discover.go` — `Discover(ctx, spec, envOverrides, source)` creates transport, connects MCP client, lists tools/templates with pagination, converts, returns `DiscoveredCapabilities`.

**Credential resolution** (`client-apps/cli/internal/cli/mcpserver/env_resolver.go`):
- `ResolveEnvForDiscovery(server, cfg)` reads env_spec, checks os.Environ() first, resolves from CLI config.
- `STIGMER_SERVER_ADDRESS` — `localhost:7234` for local, cloud endpoint for cloud.
- `STIGMER_API_KEY` — empty for local, stored token for cloud.
- Extensible: add a case to `resolveKnownVar` for future MCP servers (GitHub, AWS, etc.).

**Auto-discovery** (`client-apps/cli/internal/cli/mcpserver/discover_all.go`):
- `DiscoverAll(ctx, opts)` uses search API to list MCP servers, fetches each, filters to stdio-only, resolves env, discovers, pushes. Best-effort per server.

**Bootstrap wiring** (`client-apps/cli/cmd/stigmer/root/server.go`):
- `runBootstrapDiscovery(cfg)` called synchronously after daemon starts, before "Ready!" message.

**CLI refactoring:**
- `discover.go` delegates to `mcpdiscovery.Discover()` from shared library.
- Added `DiscoverServer()` for bootstrap flow (takes pre-fetched McpServer proto).
- Deleted `discover_transport.go` and `discover_convert.go` (moved to shared lib).

**Verification**: `go build ./...`, `go vet`, and `bazel build` all pass for both modules.

### Design Decisions Made

1. **`discovered_capabilities` lives in `McpServerStatus`** — Status tracks structural validation + discovered capabilities.
2. **`DiscoverySource` as an enum, not string** — Values: `seedpack`, `cli`, `agent_runner`.
3. **`input_schema` as `google.protobuf.Struct`, not `string`** — Canonical proto representation for arbitrary JSON.
4. **`DiscoveredResourceTemplate` (not `DiscoveredResource`)** — Matches MCP spec's URI template distinction.
5. **Dynamic discovery over static seedpack** — Tools/resources come from the MCP server itself via CLI discovery, not from hardcoded YAML.
6. **Custom pipeline steps for Go handler** — `UpdateDiscoveredCapabilitiesInput` uses `mcp_server_id` not `value`.
7. **`discover` as a top-level verb** — Follows existing `verb type name` CLI pattern.
8. **Both stdio and HTTP transport** — Stdio uses `CommandTransport`, HTTP uses `StreamableClientTransport`.
9. **Iterator-based pagination** — Uses MCP SDK iterators for automatic pagination.
10. **CLI-side discovery, not server-side** — Server stays lean, no MCP SDK dependency. All process spawning and credential resolution in the CLI.
11. **Synchronous discovery** — Blocks `stigmer server` startup until discovery completes; capabilities available immediately.
12. **Shared library in `backend/libs/go/mcpdiscovery/`** — Core MCP protocol logic reusable by both CLI and (potentially) server in the future.
13. **Env resolver with priority: shell > CLI config > skip** — User's env vars always win; CLI config fills gaps.

## Next Steps

### End-to-End Testing

1. Run `stigmer server` and verify discovery triggers automatically after bootstrap
2. Verify `stigmer discover mcp-server stigmer-mcp-server` works as a standalone command
3. Check that 12 tools and 5 resource templates are discovered and stored
4. Verify `get mcp-server` shows the discovered capabilities in status

### Future Work

- Add GitHub MCP server to seedpack with `GITHUB_TOKEN` resolver (reads from `~/.config/gh/hosts.yml`)
- Add AWS MCP server with credential resolver (reads from `~/.aws/credentials`)
- Expose discovered capabilities in agent config UI so users can see available tools

## Context for Resume

- All 5 phases are implemented and compile cleanly
- Proto foundation, RPC handlers (Go + Java), CLI command, and bootstrap integration are complete
- The shared library `backend/libs/go/mcpdiscovery/` contains the reusable MCP discovery core
- The env resolver pattern is ready for extension (add cases for `GITHUB_TOKEN`, `AWS_*`, etc.)
- MCP SDK (`v1.3.0`) is a dependency of both `client-apps/cli` and `backend/libs/go` modules
- Pre-existing Bazel issue with `com_github_charmbracelet_glamour` in `mdrender/BUILD.bazel` (not ours)

## Essential Files

### Shared library (Phase 5 output)
- `backend/libs/go/mcpdiscovery/discover.go` — Core discovery logic
- `backend/libs/go/mcpdiscovery/transport.go` — Transport factory with env merge
- `backend/libs/go/mcpdiscovery/convert.go` — MCP SDK → proto type conversion

### CLI bootstrap discovery (Phase 5 output)
- `client-apps/cli/internal/cli/mcpserver/env_resolver.go` — Credential resolution
- `client-apps/cli/internal/cli/mcpserver/discover_all.go` — DiscoverAll for bootstrap
- `client-apps/cli/internal/cli/mcpserver/discover.go` — Refactored orchestration
- `client-apps/cli/cmd/stigmer/root/server.go` — Bootstrap wiring (runBootstrapDiscovery)

### Proto files (Phase 1 output)
- `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` — DiscoveredCapabilities, DiscoveredTool, DiscoveredResourceTemplate, DiscoverySource
- `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` — UpdateDiscoveredCapabilitiesInput
- `apis/ai/stigmer/agentic/mcpserver/v1/command.proto` — updateDiscoveredCapabilities RPC

### Go RPC handler (Phase 3 output)
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/update_discovered_capabilities.go`
- `backend/services/stigmer-server/pkg/downstream/mcpserver/client.go`

### Java RPC handler (Phase 3 output)
- `backend/services/stigmer-service/.../McpServerUpdateDiscoveredCapabilitiesHandler.java`
- `backend/services/stigmer-service/.../McpServerGrpcAutoController.java`

### CLI discover command (Phase 4 output)
- `client-apps/cli/cmd/stigmer/root/discover.go` — Cobra command definition
- `client-apps/cli/internal/cli/mcpserver/discover_display.go` — Terminal display

### Project documentation
- `_projects/2026-02/20260225.02.mcp-tool-discovery/tasks/T01_0_plan.md` — Full implementation plan

## Quick Commands

After loading context:
- "Run end-to-end test" — Test the full discovery flow
- "Add GitHub MCP server" — Next credential resolver to implement
- "Show project status" — Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
