---
name: T11-A Write Operations
overview: "Add 7 mutation tools to the MCP server: 3 apply tools (agents, mcp-servers, workflows) and 4 delete tools (agents, mcp-servers, workflows, skills). Skills apply is deferred because the backend only supports binary ZIP push."
todos:
  - id: shared-unmarshal
    content: Add UnmarshalJSON to domains/jsonutil.go with DiscardUnknown:true + test
    status: completed
  - id: agents-apply
    content: "Implement apply_agent: apply_tool.go, apply.go, apply_tool_test.go"
    status: completed
  - id: agents-delete
    content: "Implement delete_agent: delete_tool.go, delete.go, delete_tool_test.go"
    status: completed
  - id: mcpservers-apply
    content: "Implement apply_mcp_server: apply_tool.go, apply.go, apply_tool_test.go"
    status: completed
  - id: mcpservers-delete
    content: "Implement delete_mcp_server: delete_tool.go, delete.go, delete_tool_test.go (uses ApiResourceDeleteInput)"
    status: completed
  - id: workflows-apply
    content: "Implement apply_workflow: apply_tool.go, apply.go, apply_tool_test.go"
    status: completed
  - id: workflows-delete
    content: "Implement delete_workflow: delete_tool.go, delete.go, delete_tool_test.go"
    status: completed
  - id: skills-delete
    content: "Implement delete_skill: delete_tool.go, delete.go, delete_tool_test.go (delete only, no apply)"
    status: completed
  - id: server-registration
    content: Update server.go registerTools() to wire all 7 new tools, update tool count log
    status: completed
  - id: verification
    content: Run go test -race ./..., go vet ./... — all green, no regressions
    status: completed
isProject: false
---

# T11-A: Write Operations for MCP Server

## Scope

7 new MCP tools:


| Tool | Domain | Backend RPC |
| ---- | ------ | ----------- |


- `apply_agent` — `AgentCommandController.apply(Agent)` — create or update
- `apply_mcp_server` — `McpServerCommandController.apply(McpServer)` — create or update
- `apply_workflow` — `WorkflowCommandController.apply(Workflow)` — create or update
- `delete_agent` — fetch-then-delete via `AgentCommandController.delete(AgentId)`
- `delete_skill` — fetch-then-delete via `SkillCommandController.delete(SkillId)`
- `delete_mcp_server` — fetch-then-delete via `McpServerCommandController.delete(ApiResourceDeleteInput)`
- `delete_workflow` — fetch-then-delete via `WorkflowCommandController.delete(WorkflowId)`

**Excluded**: `apply_skill` — the backend's `SkillCommandController.push` requires binary ZIP artifact, incompatible with MCP text-based tools.

## Key Design Decisions

### Apply: accept full resource JSON as a string

The apply tools accept the full protobuf resource as a JSON string, matching kubectl/Terraform semantics. We unmarshal with `protojson.UnmarshalOptions{DiscardUnknown: true}` (lenient — AI clients may produce extra fields). The backend handles deep validation via buf validate rules.

```go
type ApplyAgentInput struct {
    Resource string `json:"resource" jsonschema:"required,description=..."`
}
```

This avoids coupling the MCP tool schema to proto field changes. Any proto evolution is automatically supported.

### Delete: fetch-then-delete by org+slug

All delete RPCs require a system-generated UUID, but users know resources by org+slug. Each delete tool:

1. Opens one gRPC connection
2. Calls `QueryController.GetByReference(org, slug)` to resolve the ID
3. Calls `CommandController.Delete(id)` using the resolved ID
4. Returns the deleted resource as JSON

```go
type DeleteAgentInput struct {
    Org  string `json:"org"  jsonschema:"required,..."`
    Slug string `json:"slug" jsonschema:"required,..."`
}
```

### Shared utility: add UnmarshalJSON to [domains/jsonutil.go](mcp-server/internal/domains/jsonutil.go)

```go
var UnmarshalOptions = protojson.UnmarshalOptions{
    DiscardUnknown: true,
}

func UnmarshalJSON(data string, msg proto.Message) error { ... }
```

## File Structure Per Domain

Using agents as the template (same pattern for mcpservers, workflows; skills gets delete-only):

```
mcp-server/internal/domains/agents/
├── tools.go              (existing — get_agent, unchanged)
├── resources.go          (existing — unchanged)
├── fetch.go              (existing — unchanged)
├── apply_tool.go         (NEW — ApplyTool, ApplyHandler, ApplyAgentInput)
├── apply.go              (NEW — Apply function: unmarshal JSON → gRPC apply)
├── delete_tool.go        (NEW — DeleteTool, DeleteHandler, DeleteAgentInput)
├── delete.go             (NEW — Delete function: fetch→extract ID→gRPC delete)
├── tools_test.go         (existing — unchanged)
├── resources_test.go     (existing — unchanged)
├── apply_tool_test.go    (NEW — mock CommandController, success + error cases)
└── delete_tool_test.go   (NEW — mock both Query+Command, success + error cases)
```

### Test Pattern

Tests follow the established pattern: embed `Unimplemented*Server`, override methods, start real gRPC server via `testutil.StartGRPCServer`. Each test file covers:

- Tool metadata validation
- Success path (mock returns expected response)
- Invalid input (malformed JSON for apply, missing fields)
- gRPC error propagation (NotFound, PermissionDenied, etc.)
- For delete: verify both RPCs are called (query then command)

### Server Registration

Update [server.go](mcp-server/internal/server/server.go) `registerTools()` to add the 7 new tools. Tool count goes from 5 to 12.

## Domain-Specific Notes

### MCP Servers Delete

Uses `ApiResourceDeleteInput{resource_id, version_message, force}` instead of a simple ID wrapper. We set `force: false` and `version_message: ""` as safe defaults. These can be exposed as optional fields later if needed.

### Skills

Only `delete_skill` is implemented. The tool description should explicitly note that skill creation/update is done via `stigmer skill push` CLI.

## Implementation Order

The agents domain is implemented first to establish the pattern, then remaining domains follow by replication.

1. **Shared utility** — add `UnmarshalJSON` to `jsonutil.go` + test
2. **Agents** — apply + delete + tests (establishes the pattern)
3. **MCP Servers** — apply + delete + tests (note: delete uses `ApiResourceDeleteInput`)
4. **Workflows** — apply + delete + tests
5. **Skills** — delete only + tests
6. **Server registration** — update `server.go` to wire all 7 new tools
7. **Verification** — `go test -race ./...`, `go vet ./...`

