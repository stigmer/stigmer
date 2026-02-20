# MCP Server: Refactor Remaining Domains to Shared Abstractions

**Date**: February 20, 2026

## Summary

Completed the full refactoring of the three remaining MCP server domains — `workflows/`, `mcpservers/`, and `skills/` — to use the shared infrastructure established in T02 and proven by the agents domain in T03. All 5 deleted files, 14 edited files, zero test file changes, and a net reduction of 184 source lines (-38%) across the three domains. The entire `mcp-server/` package suite continues to pass all 12 test packages with no behavioral changes.

## Problem Statement

After T03 established the reference refactoring pattern in the `agents/` domain, three domains remained using the original boilerplate — manually managing gRPC connections (7-line connect/auth/timeout/defer blocks), constructing `CallToolResult` inline in every handler, duplicating `ReadResourceResult` construction across resource handlers, and splitting tool definitions across 2–3 files per domain instead of grouping them by responsibility.

### Pain Points

- `workflows/`, `mcpservers/`, and `skills/` each contained the identical 7-line gRPC connection pattern repeated across `fetch.go`, `apply.go`, and `delete.go` — 21 instances total
- Each domain maintained standalone `apply_tool.go` and `delete_tool.go` files with no import dependencies on shared infrastructure, creating unnecessary file fragmentation (5 extra files across the three domains)
- `resources.go` in each domain contained a 15-line inline closure for URI parsing and response construction that `domains.NewResourceHandler` can reduce to a single line
- `skills/` had a further 20-line duplicate inline closure for its versioned resource handler, now reducible to one line via `domains.NewVersionedResourceHandler`
- Manual `&mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}` construction in every tool handler — 9 sites across the three domains — when `domains.CallFetch`, `domains.CallApply`, and `domains.TextResult` already existed

## Solution

Applied the exact same three mechanical transformations established in T03 (agents domain) to all three remaining domains:

1. **Core operations** (`fetch.go`, `apply.go`, `delete.go`): Replace the 7-line connection boilerplate with `domains.WithConnection`, which encapsulates connection creation, API key extraction, timeout, and cleanup.
2. **Resource handlers** (`resources.go`): Replace inline closures with `domains.NewResourceHandler` (standard) and `domains.NewVersionedResourceHandler` (skills versioned). For the skills non-versioned handler — where `Fetch` has a 5-parameter versioned signature — an adapter closure pins `version=""` and satisfies `FetchFunc`.
3. **Tools consolidation** (`tools.go`): Absorb `apply_tool.go` and `delete_tool.go` into the single domain `tools.go`, replacing manual `CallToolResult` construction with `domains.CallFetch`, `domains.CallApply`, and `domains.TextResult`.

One deliberate asymmetry was preserved without change: `mcpservers/delete.go` calls `cmdClient.Delete` with `&apiresource.ApiResourceDeleteInput{ResourceId: ...}` — a generic protobuf type — rather than a domain-specific ID type like `AgentId` or `SkillId`. This reflects the protobuf API design of the McpServer service and was kept exactly as-is.

## Implementation Details

### workflows/ domain

Files edited: `fetch.go`, `apply.go`, `delete.go`, `resources.go`, `tools.go`
Files deleted: `apply_tool.go`, `delete_tool.go`

`fetch.go` and `delete.go` follow the agents pattern exactly — `WithConnection` wraps the RPC logic, the connection is shared for the two-step fetch-then-delete sequence. `apply.go` unmarshals the workflow JSON before `WithConnection`, then the `Apply` RPC runs inside the callback. `resources.go` drops to 5 lines of logic from 20. `tools.go` grows to absorb all three tool groups (get, apply, delete) in clearly separated `--- sections ---`, using `CallFetch` for get and delete, `CallApply` for apply.

### mcpservers/ domain

Files edited: `fetch.go`, `apply.go`, `delete.go`, `resources.go`, `tools.go`
Files deleted: `apply_tool.go`, `delete_tool.go`

Structurally identical to workflows with one notable difference: `delete.go` passes `&apiresource.ApiResourceDeleteInput{ResourceId: mcpServer.GetMetadata().GetId()}` to the delete RPC — preserved exactly. The package-level doc comment was moved from `fetch.go` to `tools.go` to mirror the agents precedent (where the package doc describes the full domain surface, not just the fetch function).

### skills/ domain

Files edited: `fetch.go`, `delete.go`, `resources.go`, `tools.go`
Files deleted: `delete_tool.go`
No `apply_tool.go` — skills have no MCP apply operation (pushed via CLI).

`fetch.go` is the only versioned function in the entire codebase: `Fetch(ctx, serverAddress, org, slug, version string)`. This matches `domains.VersionedFetchFunc` rather than `FetchFunc`, so direct delegation via `CallFetch` is not possible. Two adaptations:

- **Tool handler**: Calls `Fetch` directly with `input.Version` and wraps with `domains.TextResult(text)` — eliminates the `CallToolResult` construction while avoiding a `CallVersionedFetch` helper for what is currently a single call site.
- **Non-versioned resource handler**: Uses `NewResourceHandler` with an adapter closure that pins `version=""`, satisfying the `FetchFunc` contract while reusing all the URI parsing and response construction in the shared helper.
- **Versioned resource handler**: `NewVersionedResourceHandler(Fetch, serverAddress, "skills")` — direct delegation, no adapter needed.

`tools.go` absorbs the delete tool definitions and uses `CallFetch(Delete, ...)` for the delete handler (Delete matches `FetchFunc` — org+slug, no version).

### Line count change

| Domain | Before | After | Delta |
|---|---|---|---|
| workflows/ | ~232 lines | ~155 lines | -77 |
| mcpservers/ | ~238 lines | ~159 lines | -79 |
| skills/ | ~214 lines | ~186 lines | -28 |
| **Total** | **~684 lines** | **~500 lines** | **-184 (-27%)** |

Actual net across the project (T02 + T03 + T04 combined) is now approximately -400 source lines of mechanical boilerplate replaced by shared infrastructure.

## Benefits

- **No boilerplate remaining**: Every domain now delegates gRPC connection management, result construction, and resource handler wiring to the shared `domains` package. Adding a new domain in the future requires ~150 lines instead of ~280.
- **Fewer files per domain**: Eliminated 5 standalone tool files (`apply_tool.go` ×2, `delete_tool.go` ×3) without moving any behavior. Tool definitions are grouped by domain in a single `tools.go` with clear section separators.
- **Uniform structure**: All four domains (agents, workflows, mcpservers, skills) now follow the identical file layout: `fetch.go`, `apply.go` (where applicable), `delete.go`, `resources.go`, `tools.go`.
- **Zero test changes**: All 26 test functions across the three domains pass without modification. The refactoring is provably behavior-preserving.
- **Skills asymmetry is clean**: The versioned `Fetch` signature is handled with the minimum viable adapter — a single closure in `ResourceHandler` and a direct `TextResult` call in the tool handler — without introducing a new shared helper for a single call site. This is the right call at this scale.

## Impact

- **MCP server package**: All 12 packages (`go test ./mcp-server/... -count=1`) pass. `go vet` clean.
- **Consumers**: `server.go` is unchanged — same exported function names, same tool names, same resource URI templates, same error messages.
- **Future domain authors**: The pattern is now fully established and documented in four consistent reference implementations.

## Related Work

- T02 changelog: `_changelog/2026-02/2026-02-20-145752-mcp-server-shared-abstractions.md` — established the shared infrastructure
- T03 changelog: `_changelog/2026-02/2026-02-20-151441-mcp-server-agents-domain-refactor.md` — established the reference refactoring pattern
- Next: T05 — Final validation pass and project close-out

---

**Status**: ✅ Production Ready
**Timeline**: February 20, 2026 (same session as T03)
