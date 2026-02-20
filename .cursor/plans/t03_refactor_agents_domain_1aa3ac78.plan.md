---
name: T03 Refactor Agents Domain
overview: Refactor the agents domain (7 files, ~278 lines) to use T02's shared abstractions, reducing to 5 files (~150 lines) while keeping all 4 test files and the server.go registration completely unchanged.
todos:
  - id: refactor-fetch
    content: Refactor fetch.go to use domains.WithConnection
    status: completed
  - id: refactor-apply
    content: Refactor apply.go to use domains.WithConnection
    status: completed
  - id: refactor-delete
    content: Refactor delete.go to use domains.WithConnection
    status: completed
  - id: refactor-resources
    content: Refactor resources.go to use domains.NewResourceHandler
    status: completed
  - id: merge-tools
    content: Merge all tool definitions into tools.go using CallFetch/CallApply, delete apply_tool.go and delete_tool.go
    status: completed
  - id: run-tests
    content: Run go test ./mcp-server/... -count=1 and verify all pass
    status: completed
isProject: false
---

# T03: Refactor Agents Domain to Use Shared Abstractions

## Scope

Refactor `mcp-server/internal/domains/agents/` from manual boilerplate to the shared abstractions built in T02. This is the **reference refactoring** — the pattern established here will be replicated across workflows, mcpservers, and skills in T04.

## What Changes

**5 source files edited or rewritten:**

- [fetch.go](mcp-server/internal/domains/agents/fetch.go) — replace 7-line connection boilerplate with `domains.WithConnection`
- [apply.go](mcp-server/internal/domains/agents/apply.go) — replace 7-line connection boilerplate with `domains.WithConnection`
- [delete.go](mcp-server/internal/domains/agents/delete.go) — replace 7-line connection boilerplate with `domains.WithConnection`
- [resources.go](mcp-server/internal/domains/agents/resources.go) — replace manual handler with `domains.NewResourceHandler`
- [tools.go](mcp-server/internal/domains/agents/tools.go) — use `domains.CallFetch`/`domains.CallApply`, absorb content from `apply_tool.go` and `delete_tool.go`

**2 source files deleted (content merged into tools.go):**

- `apply_tool.go` — ApplyAgentInput, ApplyTool(), ApplyHandler() move to `tools.go`
- `delete_tool.go` — DeleteAgentInput, DeleteTool(), DeleteHandler() move to `tools.go`

**0 test files changed:**

- `tools_test.go`, `apply_tool_test.go`, `delete_tool_test.go`, `resources_test.go` — all remain as-is

**0 changes to server.go:**

- All exported function names (`Tool`, `Handler`, `ApplyTool`, `ApplyHandler`, `DeleteTool`, `DeleteHandler`, `Template`, `ResourceHandler`) stay identical

## Before/After File Structure

```
BEFORE (7 source + 4 test = 11 files, ~278 source lines)
  tools.go (38)  apply_tool.go (34)  delete_tool.go (35)
  fetch.go (39)  apply.go (40)       delete.go (50)
  resources.go (46)

AFTER (5 source + 4 test = 9 files, ~150 source lines)
  tools.go (~55)     — all 3 tool definitions + handlers
  fetch.go (~20)     — Fetch with WithConnection
  apply.go (~22)     — Apply with WithConnection
  delete.go (~27)    — Delete with WithConnection
  resources.go (~22) — Template + NewResourceHandler
```

## Refactoring Details Per File

### 1. fetch.go — WithConnection

Current: manually creates connection, sets auth, sets timeout (7 lines of ceremony).

After: single `domains.WithConnection` call wrapping only the domain-specific RPC:

```go
func Fetch(ctx context.Context, serverAddress, org, slug string) (string, error) {
    return domains.WithConnection(ctx, serverAddress,
        func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
            client := agentv1.NewAgentQueryControllerClient(conn)
            agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
                Org: org, Kind: apiresourcekind.ApiResourceKind_agent, Slug: slug,
            })
            if err != nil {
                return "", domains.RPCError(err, fmt.Sprintf("agent %q in org %q", slug, org))
            }
            return domains.MarshalJSON(agent)
        })
}
```

Removed imports: `auth`, `stigmergrpc`. Added import: `grpc`.

### 2. apply.go — WithConnection

Same pattern. Unmarshal stays outside `WithConnection` (fail fast before opening a connection). The closure does the RPC call.

### 3. delete.go — WithConnection

Same pattern. Both `GetByReference` and `Delete` RPCs share the single connection provided by `WithConnection`, exactly as they do today.

### 4. resources.go — NewResourceHandler

Current `ResourceHandler` is 18 lines of manual URI parsing, fetching, and result wrapping. Becomes a single delegation:

```go
func ResourceHandler(serverAddress string) mcp.ResourceHandler {
    return domains.NewResourceHandler(Fetch, serverAddress, "agents")
}
```

The error format `"agents resource: %w"` is preserved identically by `NewResourceHandler`.

### 5. tools.go — CallFetch/CallApply + merge

The three tool definitions (get, apply, delete) consolidate into one file. Each handler body shrinks from 4 lines to 1 line:

- `Handler`: `return domains.CallFetch(Fetch, ctx, serverAddress, input.Org, input.Slug)`
- `ApplyHandler`: `return domains.CallApply(Apply, ctx, serverAddress, input.Resource)`
- `DeleteHandler`: `return domains.CallFetch(Delete, ctx, serverAddress, input.Org, input.Slug)`

### 6. Delete apply_tool.go and delete_tool.go

These files become empty after their content moves to `tools.go`. Must be deleted atomically with the tools.go merge to avoid duplicate symbol errors.

## Known Behavioral Difference (Flagging for Awareness)

**Connection error wrapping**: Current code wraps connection failures with domain-specific prefixes like `"agents.Fetch: ..."`, `"agents.Apply: ..."`. After refactoring, `WithConnection` returns the raw `stigmergrpc.NewConnection` error without a prefix. This only affects the connection-error path (not the RPC-error path, which uses `RPCError` unchanged). No tests assert on these prefixes, and the underlying error from `NewConnection` is already descriptive. I consider this acceptable — adding a prefix parameter to `WithConnection` would complicate its API for marginal diagnostic value.

## Execution Order

Changes are ordered so that tests could theoretically pass after each step (though we'll run them once at the end):

1. Refactor `fetch.go` (Fetch signature unchanged, only internals change)
2. Refactor `apply.go` (Apply signature unchanged)
3. Refactor `delete.go` (Delete signature unchanged)
4. Refactor `resources.go` (ResourceHandler signature unchanged)
5. Merge tool definitions into `tools.go` + delete `apply_tool.go` and `delete_tool.go` (all exported symbols preserved)
6. Run `go test ./mcp-server/... -count=1` — all tests must pass

## Success Criteria

- All 4 existing test files pass without any modification
- Exported API surface is identical (same function names, same signatures)
- MCP tool surface is identical (same tool names, descriptions, input schemas)
- No new imports of `auth` or `stigmergrpc` in the agents package (these are now handled by `domains.WithConnection`)
- Net line reduction of ~~128 lines (~~278 to ~150)

