---
name: T04 Refactor Remaining Domains
overview: Refactor workflows/, mcpservers/, and skills/ domains to use shared abstractions from the domains package, following the exact pattern established in the agents/ reference domain. Expected net reduction of ~390 source lines. Zero test file changes.
todos:
  - id: t04-workflows
    content: "Refactor workflows/ domain: edit fetch.go, apply.go, delete.go, resources.go, tools.go; delete apply_tool.go and delete_tool.go; run tests"
    status: completed
  - id: t04-mcpservers
    content: "Refactor mcpservers/ domain: edit fetch.go, apply.go, delete.go, resources.go, tools.go; delete apply_tool.go and delete_tool.go; run tests. Preserve ApiResourceDeleteInput in delete.go."
    status: completed
  - id: t04-skills
    content: "Refactor skills/ domain: edit fetch.go, delete.go, resources.go, tools.go; delete delete_tool.go; run tests. Handle versioned Fetch signature with TextResult + adapter closure."
    status: completed
  - id: t04-validate
    content: "Final validation: go test ./mcp-server/... -count=1, go vet, verify no raw stigmergrpc.NewConnection calls remain in refactored domains"
    status: completed
isProject: false
---

# T04: Refactor Remaining Domains (workflows, mcpservers, skills)

## Reference Pattern (agents/ domain — DONE)

The refactored agents domain establishes three mechanical transformations:

1. **Core operations** (`fetch.go`, `apply.go`, `delete.go`): Replace the 7-line connect/auth/timeout/defer pattern with `domains.WithConnection`
2. **Resources** (`resources.go`): Replace inline handler with `domains.NewResourceHandler(Fetch, serverAddress, "agents")`
3. **Tools** (`tools.go`): Absorb `apply_tool.go` and `delete_tool.go` into a single `tools.go`, using `domains.CallFetch`/`domains.CallApply` instead of manual `CallToolResult` construction

## Execution Order

Process domains sequentially. Run `go test ./mcp-server/internal/domains/{domain}/... -count=1` after each domain. This catches regressions immediately and keeps the blast radius small.

---

## Phase 1: Refactor `workflows/`

Structurally identical to agents. No surprises expected.

### Files to edit (5):

- **[fetch.go](mcp-server/internal/domains/workflows/fetch.go)** (39 -> ~15 lines): Remove `auth`, `stigmergrpc` imports. Replace manual connection block with `domains.WithConnection`. The callback receives `(ctx, conn)` and contains only the RPC call + error handling.
- **[apply.go](mcp-server/internal/domains/workflows/apply.go)** (39 -> ~18 lines): Same transformation. `UnmarshalJSON` call stays before `WithConnection`; the RPC call moves inside the callback.
- **[delete.go](mcp-server/internal/domains/workflows/delete.go)** (50 -> ~25 lines): Same transformation. Both query + command RPCs move inside a single `WithConnection` callback (they share the connection).
- **[resources.go](mcp-server/internal/domains/workflows/resources.go)** (46 -> ~24 lines): Replace the inline closure with `domains.NewResourceHandler(Fetch, serverAddress, "workflows")`. Remove `context` and `fmt` imports.
- **[tools.go](mcp-server/internal/domains/workflows/tools.go)** (37 -> ~81 lines — absorbs two files): Add `domains` import. Absorb `ApplyWorkflowInput`, `ApplyTool()`, `ApplyHandler()` from `apply_tool.go`, and `DeleteWorkflowInput`, `DeleteTool()`, `DeleteHandler()` from `delete_tool.go`. Replace manual `CallToolResult` construction with `domains.CallFetch` (for get + delete) and `domains.CallApply` (for apply).

### Files to delete (2):

- `apply_tool.go` — absorbed into tools.go
- `delete_tool.go` — absorbed into tools.go

### Test files: UNCHANGED (4 files: tools_test.go, resources_test.go, apply_tool_test.go, delete_tool_test.go)

---

## Phase 2: Refactor `mcpservers/`

Nearly identical to workflows, with one structural difference to preserve.

### Difference: Delete RPC uses generic `ApiResourceDeleteInput`

`mcpservers/delete.go` calls `cmdClient.Delete(rpcCtx, &apiresource.ApiResourceDeleteInput{ResourceId: ...})` — a generic protobuf type. Agents and skills use domain-specific ID types (`AgentId`, `SkillId`). This is a deliberate protobuf API difference; the refactoring must preserve it exactly.

### Files to edit (5):

- **[fetch.go](mcp-server/internal/domains/mcpservers/fetch.go)** (43 -> ~17 lines): Same `WithConnection` transformation.
- **[apply.go](mcp-server/internal/domains/mcpservers/apply.go)** (39 -> ~18 lines): Same transformation.
- **[delete.go](mcp-server/internal/domains/mcpservers/delete.go)** (50 -> ~25 lines): Same `WithConnection` transformation. Preserves `ApiResourceDeleteInput` (not a domain-specific ID type).
- **[resources.go](mcp-server/internal/domains/mcpservers/resources.go)** (45 -> ~24 lines): Replace inline closure with `domains.NewResourceHandler(Fetch, serverAddress, "mcpservers")`.
- **[tools.go](mcp-server/internal/domains/mcpservers/tools.go)** (36 -> ~81 lines): Absorb apply + delete tool definitions. Use `domains.CallFetch`/`domains.CallApply`.

### Files to delete (2):

- `apply_tool.go` — absorbed into tools.go
- `delete_tool.go` — absorbed into tools.go

### Test files: UNCHANGED (4 files)

---

## Phase 3: Refactor `skills/`

Skills differs from the other domains in two important ways:

1. **No apply operation** — skills are pushed via CLI, not through an MCP tool
2. **Versioned Fetch** — `Fetch(ctx, serverAddress, org, slug, version)` has 5 params, not 4

### Implications of the versioned signature

- `skills.Fetch` matches `domains.VersionedFetchFunc`, NOT `domains.FetchFunc`
- `domains.CallFetch` cannot wrap it directly
- `skills.Delete` matches `domains.FetchFunc` (org + slug, no version)

### Approach for the get_skill tool handler

Since `CallFetch` doesn't fit the versioned signature and skills is the only versioned domain, the handler will call `Fetch` directly and wrap the result with `domains.TextResult`:

```go
func Handler(serverAddress string) func(...) {
    return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetSkillInput) (*mcp.CallToolResult, any, error) {
        text, err := Fetch(ctx, serverAddress, input.Org, input.Slug, input.Version)
        if err != nil {
            return nil, nil, err
        }
        return domains.TextResult(text)
    }
}
```

This uses `TextResult` to eliminate the `CallToolResult` construction boilerplate while avoiding a `CallVersionedFetch` helper for a single call site.

### Approach for the non-versioned resource handler

`NewResourceHandler` expects `FetchFunc` (4 params). Wrap with a closure that pins `version=""`:

```go
func ResourceHandler(serverAddress string) mcp.ResourceHandler {
    return domains.NewResourceHandler(
        func(ctx context.Context, addr, org, slug string) (string, error) {
            return Fetch(ctx, addr, org, slug, "")
        },
        serverAddress, "skills",
    )
}
```

### Files to edit (4):

- **[fetch.go](mcp-server/internal/domains/skills/fetch.go)** (40 -> ~18 lines): Replace manual connection block with `domains.WithConnection`. The `version` parameter passes through to the RPC call inside the callback.
- **[delete.go](mcp-server/internal/domains/skills/delete.go)** (51 -> ~25 lines): Same `WithConnection` transformation.
- **[resources.go](mcp-server/internal/domains/skills/resources.go)** (83 -> ~35 lines): Non-versioned handler uses `NewResourceHandler` with an adapter closure. Versioned handler uses `NewVersionedResourceHandler(Fetch, serverAddress, "skills")`. Remove `context` and `fmt` imports.
- **[tools.go](mcp-server/internal/domains/skills/tools.go)** (43 -> ~60 lines): Absorb `DeleteSkillInput`, `DeleteTool()`, `DeleteHandler()` from `delete_tool.go`. Get handler uses `domains.TextResult`. Delete handler uses `domains.CallFetch(Delete, ...)`.

### Files to delete (1):

- `delete_tool.go` — absorbed into tools.go

### Test files: UNCHANGED (3 files: tools_test.go, resources_test.go, delete_tool_test.go)

---

## Phase 4: Final validation

- `go test ./mcp-server/... -count=1` — all 12 packages pass
- `go vet ./mcp-server/...` — no warnings
- Verify no `stigmergrpc.NewConnection` or `auth.APIKey` calls remain in any of the three refactored domains' fetch/apply/delete files (those should now be encapsulated by `WithConnection`)

## Success Criteria

- All existing tests pass without modification
- Same tool names, descriptions, input schemas, error messages
- No behavioral changes — the MCP surface is identical
- No new dependencies or shared abstractions needed (everything already exists in the domains package)

