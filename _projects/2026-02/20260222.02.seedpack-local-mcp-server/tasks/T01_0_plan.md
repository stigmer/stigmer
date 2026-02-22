# Task T01: Seedpack Local MCP Server — Design & Implementation Plan

**Created**: 2026-02-22 17:20
**Status**: PENDING REVIEW
**Type**: Feature Development
**Timeline**: 1-2 days

⚠️ **This plan requires your review before execution**

## Objective

When `stigmer server` starts, a local MCP server should also be started automatically and registered as a seedpack resource. This makes the Stigmer MCP server available by default alongside the existing `skill-creator` skill and `skill-creator-agent`.

## Background & Current State

The seedpack currently contains:
- **1 skill**: `skill-creator` (vendored from Anthropic)
- **1 system agent**: `skill-creator-agent`

The bootstrap process (`bootstrap.go`) applies these resources on server startup via the embedded `seedpack` package. MCP server resources are already a first-class API resource with full CRUD support, but no MCP servers are bootstrapped from the seedpack.

The `stigmer mcp-server` command already exists and can start an MCP server that connects to the Stigmer server via gRPC, exposing all Stigmer resources (agents, skills, workflows, MCP servers) to MCP clients.

## Design Decision: Startup Approach

Two approaches are viable for starting the MCP server process:

### Option A: Daemon subprocess (recommended)
The daemon (`daemon.go`) already manages subprocesses for the internal server. We add MCP server as another managed subprocess, started after the Stigmer server is healthy.

**Pros**: Clean process isolation, consistent with existing pattern, PID tracking, easy to stop/restart independently.
**Cons**: Extra process to manage.

### Option B: In-process (embedded in stigmer-server)
Start the MCP server goroutine within the stigmer-server process itself, similar to how the component supervisor runs.

**Pros**: No extra process, simpler lifecycle.
**Cons**: Couples MCP server to server process, mixes concerns, STDIO transport would conflict with the server's own stdio.

**Recommendation**: Option A (daemon subprocess) for STDIO transport, which is the user's preference. The daemon already has the pattern for this, and STDIO transport requires a dedicated process with clean stdin/stdout.

## Implementation Plan

### Phase 1: Seedpack — Add MCP Server Resource

**Goal**: Add a `stigmer-mcp-server` resource definition to the seedpack so it gets bootstrapped on startup.

#### 1.1 Add MCP Server Entry to Manifest

Update `seedpack/manifest.json` to include a new `mcp_servers` array:

```json
{
  "schema_version": "3",
  "version": "1.2.0",
  ...
  "mcp_servers": [
    {
      "name": "stigmer-mcp-server",
      "path": "mcp-servers/stigmer-mcp-server.yaml"
    }
  ]
}
```

**Files**: `backend/services/stigmer-server/pkg/seedpack/manifest.json`

#### 1.2 Create MCP Server YAML Definition

Create `seedpack/mcp-servers/stigmer-mcp-server.yaml` following the `McpServer` proto schema:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: Stigmer MCP Server
  visibility: VISIBILITY_PUBLIC
spec:
  description: "Built-in MCP server that exposes Stigmer resources (agents, skills, workflows) to MCP clients."
  tags:
    - system
    - built-in
  stdio:
    command: "stigmer"
    args:
      - "mcp-server"
```

This defines a STDIO-based MCP server using the `stigmer mcp-server` command. When agents use this MCP server, the agent-runner will spawn the process.

**Files**: `backend/services/stigmer-server/pkg/seedpack/mcp-servers/stigmer-mcp-server.yaml` (new)

#### 1.3 Update Seedpack Go Code

Add `McpServerEntry` struct and `LoadMcpServerYAML()` function to `seedpack.go`, following the same pattern as `AgentEntry`/`LoadAgentYAML()`.

Add `mcp-servers/*` to the `embed.go` directives.

**Files**:
- `backend/services/stigmer-server/pkg/seedpack/seedpack.go`
- `backend/services/stigmer-server/pkg/seedpack/embed.go`

### Phase 2: Bootstrap — Apply MCP Server on Startup

**Goal**: Extend the bootstrap process to apply MCP server resources from the seedpack.

#### 2.1 Add McpServerClient Interface

Add an `McpServerClient` interface to `bootstrap.go` (similar to `SkillClient` and `AgentClient`):

```go
type McpServerClient interface {
    Apply(ctx context.Context, mcpServer *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
}
```

#### 2.2 Add `bootstrapMcpServer()` Method

Implement `bootstrapMcpServer()` following the same pattern as `bootstrapAgent()`:
- Load YAML from seedpack
- Calculate content hash
- Check if already applied (idempotent)
- Apply via McpServerClient
- Record state with `"mcpserver:<name>"` key prefix

#### 2.3 Update Bootstrapper Constructor

Add `mcpServerClient` to the `Bootstrapper` struct and `NewBootstrapper()` function.

#### 2.4 Update Run() to Bootstrap MCP Servers

Add MCP server bootstrap loop after agent bootstrap, iterating `manifest.McpServers`.

**Files**:
- `backend/services/stigmer-server/pkg/bootstrap/bootstrap.go`
- `backend/services/stigmer-server/pkg/bootstrap/BUILD.bazel`

### Phase 3: Server Wiring — Connect Bootstrap to MCP Server Controller

**Goal**: Wire the MCP server controller into the bootstrap process.

#### 3.1 Create In-Process MCP Server Client

In the server startup code (`server.go`), create an in-process gRPC client for the MCP server controller (same pattern as skill/agent clients), and pass it to the bootstrapper.

**Files**:
- `backend/services/stigmer-server/pkg/server/server.go`
- `backend/services/stigmer-server/pkg/bootstrap/BUILD.bazel`

### Phase 4: Daemon — Auto-Start MCP Server Process

**Goal**: When `stigmer server` starts, also start the MCP server process.

#### 4.1 Start MCP Server Subprocess

After the Stigmer server is healthy, start `stigmer mcp-server` as a managed subprocess in the daemon, with:
- PID file tracking (`mcp-server.pid`)
- Log output to the stigmer data directory
- Graceful shutdown coordination with the server
- STDIO transport by default

**Note**: This step needs further exploration to understand whether the MCP server should be started by the daemon or as part of the server's component supervisor. The decision depends on whether the MCP server needs to outlive individual server restarts.

**Files**:
- `client-apps/cli/internal/cli/daemon/daemon.go`

### Phase 5: Tests & Validation

#### 5.1 Update Seedpack Tests

Add test cases for:
- Loading MCP server entries from manifest
- Parsing MCP server YAML
- `GetMcpServerByName()` lookup

#### 5.2 Update Bootstrap Tests

Add test cases for:
- MCP server bootstrap flow
- Idempotent re-application
- Error handling

**Files**:
- `backend/services/stigmer-server/pkg/seedpack/seedpack_test.go`
- `backend/services/stigmer-server/pkg/bootstrap/bootstrap_test.go` (if exists)

## Task Breakdown Summary

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1.1 | Update manifest with `mcp_servers` array | `manifest.json` | Small |
| 1.2 | Create MCP server YAML definition | `mcp-servers/stigmer-mcp-server.yaml` | Small |
| 1.3 | Add Go types and loaders for MCP servers | `seedpack.go`, `embed.go` | Medium |
| 2.1-2.4 | Extend bootstrap for MCP servers | `bootstrap.go`, `BUILD.bazel` | Medium |
| 3.1 | Wire MCP server client in server startup | `server.go` | Medium |
| 4.1 | Auto-start MCP server in daemon | `daemon.go` | Medium |
| 5.1-5.2 | Tests | `seedpack_test.go` | Small |

## Open Questions

1. **MCP Server YAML schema**: Should the seedpack MCP server YAML follow the exact proto schema (`McpServer` message), or use a simplified format that gets transformed during bootstrap? (Recommend: follow proto schema for consistency with agent YAML pattern)

2. **Schema version bump**: Should `manifest.json` bump `schema_version` to "3" since we're adding a new `mcp_servers` field? (Recommend: yes)

3. **Daemon vs Server supervisor**: Should the MCP server process be managed by the daemon (separate subprocess with PID file) or by the server's internal component supervisor? (Recommend: daemon, for clean process isolation with STDIO transport)

4. **MCP server auto-start scope**: Should ALL bootstrapped MCP servers be auto-started, or only the built-in `stigmer-mcp-server`? (Recommend: only the built-in one for now, with a flag like `auto_start: true` in the manifest)

## Success Criteria

- [ ] `stigmer-mcp-server` resource is defined in seedpack manifest and YAML
- [ ] Bootstrap process creates the MCP server resource on first startup
- [ ] Bootstrap is idempotent (skips if already applied)
- [ ] MCP server process starts automatically with `stigmer server`
- [ ] MCP server is functional and connects to the local Stigmer server
- [ ] Existing seedpack tests pass, new tests added

## Risks

1. **Proto compatibility**: MCP server YAML must match the proto schema exactly. Mitigation: use the same YAML→JSON→protojson pipeline as agent YAML.
2. **STDIO transport coordination**: The MCP server uses stdin/stdout for JSON-RPC, so it must run as a separate process. Mitigation: daemon subprocess with PID tracking.
3. **Bootstrap ordering**: MCP server bootstrap depends on the controller being registered. Mitigation: bootstrap runs after all gRPC services are registered.
4. **Graceful shutdown**: MCP server process must shut down when `stigmer server stop` is called. Mitigation: daemon already handles PID-based process cleanup.

## Next Task Preview

**T02: Implementation** — Execute phases 1-5 based on the approved plan.

## Review Process

**What happens next**:
1. **You review this plan** — Consider the approach, open questions, and task breakdown
2. **Provide feedback** — Share any concerns, suggestions, or changes
3. **I'll revise** — Create an updated plan incorporating your feedback
4. **You approve** — Give explicit approval to proceed
5. **Execution begins** — Implementation tracked in subsequent task files
