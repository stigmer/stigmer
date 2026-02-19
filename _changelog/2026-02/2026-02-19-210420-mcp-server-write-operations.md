# MCP Server Write Operations (T11-A)

**Date**: February 19, 2026

## Summary

Completes the Stigmer MCP server's mutation surface by adding 7 new tools — 3 apply
(create-or-update) and 4 delete — across all four resource domains. The MCP server now
exposes a full read/write API for agents, skills, MCP servers, and workflows through
AI coding assistants (Cursor, Claude Desktop, etc.). This is the final task in the
`20260217.01.stigmer-mcp-server` project, bringing the tool count from 5 to 12 and
closing the last gap between what an AI client can read and what it can manage.

## Problem Statement

The MCP server launched with a read-only tool surface: five tools for searching and
fetching resources, but no ability to create, update, or delete anything. An AI
coding assistant using the Stigmer MCP server could look up an agent or workflow but
had no way to act on it — apply a configuration change, remove a deprecated resource,
or scaffold a new one from scratch.

### Pain Points

- AI clients could discover resources but not manage them, forcing users to context-switch to the CLI for every write
- No idiomatic path for an AI to "apply" a Stigmer resource the way kubectl applies Kubernetes manifests
- No deletion capability, leaving stale resources permanently visible to AI tools
- Skills had a particularly awkward mutation story due to binary artifact requirements

## Solution

Added mutation tools following the established domain pattern (`tools.go`, `fetch.go`,
`resources.go`), with two new companion files per domain: `apply.go` + `apply_tool.go`
for create-or-update operations, and `delete.go` + `delete_tool.go` for removal.

Two architectural patterns were established for write operations:

**Apply (create-or-update)**: Tools accept the full protobuf resource as a JSON string
using `protojson.UnmarshalOptions{DiscardUnknown: true}`. This decouples the MCP tool
schema from proto field changes and keeps AI clients forward-compatible. The backend's
idempotent `apply` RPC handles the create-vs-update decision. The pattern mirrors
kubectl semantics: provide the desired state, the server converges.

**Delete (fetch-then-delete)**: All backend delete RPCs require a system-generated UUID,
but MCP clients know resources by org+slug. Each delete tool makes two RPCs over a
single shared gRPC connection — `GetByReference(org, slug)` to resolve the ID, then
`Delete(id)` — so the API surface remains natural (org+slug only) without exposing
internal UUIDs.

## Implementation Details

### Shared Utility

Added `UnmarshalJSON` and `UnmarshalOptions` to `mcp-server/internal/domains/jsonutil.go`:

```go
var UnmarshalOptions = protojson.UnmarshalOptions{
    DiscardUnknown: true,
}

func UnmarshalJSON(data string, msg proto.Message) error {
    if err := UnmarshalOptions.Unmarshal([]byte(data), msg); err != nil {
        return fmt.Errorf("protojson unmarshal: %w", err)
    }
    return nil
}
```

`DiscardUnknown: true` is the right default for an AI-facing API. AI clients
constructing resource JSON from context may include extra fields; rejecting them
would make the tools unnecessarily brittle without providing any safety benefit
(the backend validates via buf validate rules).

### Tool Inventory After T11-A

| Category | Tool | Backend RPC |
|---|---|---|
| Read | `search` | `SearchService.Search` |
| Read | `get_agent` | `AgentQueryController.GetByReference` |
| Read | `get_mcp_server` | `McpServerQueryController.GetByReference` |
| Read | `get_skill` | `SkillQueryController.GetByReference` |
| Read | `get_workflow` | `WorkflowQueryController.GetByReference` |
| Apply | `apply_agent` | `AgentCommandController.Apply` |
| Apply | `apply_mcp_server` | `McpServerCommandController.Apply` |
| Apply | `apply_workflow` | `WorkflowCommandController.Apply` |
| Delete | `delete_agent` | `AgentCommandController.Delete` via fetch-then-delete |
| Delete | `delete_mcp_server` | `McpServerCommandController.Delete` via fetch-then-delete |
| Delete | `delete_skill` | `SkillCommandController.Delete` via fetch-then-delete |
| Delete | `delete_workflow` | `WorkflowCommandController.Delete` via fetch-then-delete |

### Domain-Specific Differences

**Skills — apply not implemented**: `SkillCommandController.push` requires `bytes artifact` (a ZIP file containing SKILL.md). MCP tools exchange text/JSON — binary data cannot be passed as a tool argument. `apply_skill` is deferred until the backend adds a text-based skill mutation RPC. The `delete_skill` tool's description explicitly directs users to `stigmer skill push` for creation and updates.

**MCP Server delete uses `ApiResourceDeleteInput`**: Unlike the simple `{value: id}` ID wrappers used by agents, skills, and workflows, MCP servers use `ApiResourceDeleteInput{resource_id, version_message, force}`. Safe defaults are set (`force: false`, `version_message: ""`). These optional fields can be surfaced to the tool input in a follow-on task if audit messaging becomes important.

### File Structure Per Domain (agents as example)

```
mcp-server/internal/domains/agents/
├── tools.go              (existing — get_agent)
├── resources.go          (existing — unchanged)
├── fetch.go              (existing — unchanged)
├── apply_tool.go         (NEW — ApplyTool, ApplyHandler, ApplyAgentInput)
├── apply.go              (NEW — Apply: unmarshal JSON → gRPC apply)
├── delete_tool.go        (NEW — DeleteTool, DeleteHandler, DeleteAgentInput)
├── delete.go             (NEW — Delete: GetByReference → extract ID → Delete)
├── tools_test.go         (existing — unchanged)
├── resources_test.go     (existing — unchanged)
├── apply_tool_test.go    (NEW — 4 tests: metadata, success, invalid JSON, permission denied)
└── delete_tool_test.go   (NEW — 4 tests: metadata, success, not found, permission denied)
```

### Test Pattern

All tests follow the established pattern: embed `Unimplemented*Server`, override the
specific methods under test, start a real gRPC server via `testutil.StartGRPCServer`.
Delete tests embed both Query and Command servers on the same mock struct, validating
the full two-RPC flow:

```go
type mockAgentDeleteController struct {
    agentv1.UnimplementedAgentQueryControllerServer
    agentv1.UnimplementedAgentCommandControllerServer
    // query and delete fields...
}

func (m *mockAgentDeleteController) GetByReference(...) { ... }
func (m *mockAgentDeleteController) Delete(...) { ... }
```

### Server Registration

`registerTools()` in `server.go` now registers 12 tools in three logical groups:

```go
// Read tools
mcp.AddTool(srv, search.Tool(), ...)
mcp.AddTool(srv, agents.Tool(), ...)
...

// Write tools — apply (create or update)
mcp.AddTool(srv, agents.ApplyTool(), ...)
mcp.AddTool(srv, mcpservers.ApplyTool(), ...)
mcp.AddTool(srv, workflows.ApplyTool(), ...)

// Write tools — delete
mcp.AddTool(srv, agents.DeleteTool(), ...)
mcp.AddTool(srv, mcpservers.DeleteTool(), ...)
mcp.AddTool(srv, skills.DeleteTool(), ...)
mcp.AddTool(srv, workflows.DeleteTool(), ...)
```

## Benefits

- **Complete read/write API surface**: AI clients can now fully manage Stigmer resources without falling back to the CLI for writes
- **Natural delete UX**: `delete_agent(org, slug)` — no UUID exposure; consistent with the existing `get_agent(org, slug)` interface
- **kubectl-style apply**: AI clients provide desired state as JSON; the server handles create-vs-update; idempotent by design
- **Forward-compatible input**: `DiscardUnknown: true` means AI-generated JSON with extra fields never causes errors
- **21 new files, zero regressions**: All 12 packages pass `go test -race ./...` and `go vet ./...`
- **Consistent test coverage**: 4 tests per new tool file (metadata, success, error, missing auth) following the project's established testing discipline

## Impact

**AI coding assistant users**: Can now ask Cursor/Claude to apply a Stigmer agent configuration change directly, or remove a workflow by name — without leaving the AI session to run CLI commands.

**Platform maintainers**: 21 new files follow a single consistent pattern. Adding write operations to a new domain in the future is a matter of copying the `apply.go` + `apply_tool.go` + `delete.go` + `delete_tool.go` files and adjusting proto types — no architectural decisions required.

**Future `apply_skill`**: When the backend adds inline SKILL.md support (text-based push), the gap is clearly documented and the implementation path is obvious.

## Related Work

- [`2026-02-18-124027-mcp-server-stigmer-scaffolding.md`](2026-02-18-124027-mcp-server-stigmer-scaffolding.md) — T01–T03 initial scaffolding, auth, config
- [`2026-02-18-130941-mcp-server-test-suite.md`](2026-02-18-130941-mcp-server-test-suite.md) — T04 integration test infrastructure
- [`2026-02-19-195458-mcp-server-test-coverage-baseline.md`](2026-02-19-195458-mcp-server-test-coverage-baseline.md) — T11-B coverage baseline (72.7%)
- [`2026-02-19-153732-mcp-server-mcpservers-domain.md`](2026-02-19-153732-mcp-server-mcpservers-domain.md) — T10 MCP server domain

---

**Status**: ✅ Production Ready
**Timeline**: Session 11 (February 19, 2026) — final task in `20260217.01.stigmer-mcp-server`
