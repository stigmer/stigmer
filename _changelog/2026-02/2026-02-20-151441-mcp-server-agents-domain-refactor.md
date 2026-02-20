# T03: Refactor Agents Domain to Shared Abstractions

**Date**: February 20, 2026

## Summary

Refactored `mcp-server/internal/domains/agents/` to consume the shared infrastructure built in T02, completing the reference refactoring for the agents domain. Every line of mechanical boilerplate in the domain has been eliminated — what remains is exclusively domain-specific, curated code. This establishes the authoritative pattern for T04 (workflows, mcpservers, skills).

## Problem Statement

After T02 delivered three shared abstraction packages (`WithConnection`, `CallFetch`/`CallApply`, `NewResourceHandler`), the agents domain still held the old manual implementations — 7-line gRPC setup blocks, 5-line `CallToolResult` constructors, and 18-line resource handler bodies — unchanged.

### Pain Points

- Each of `fetch.go`, `apply.go`, and `delete.go` repeated the same 7-line `NewConnection → auth.APIKey → WithTimeout → defer` ceremony verbatim
- Each of `tools.go`, `apply_tool.go`, and `delete_tool.go` repeated the same 5-line `CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}` pattern
- `resources.go` contained 18 lines of URI parsing, Fetch delegation, and result construction that was already captured in `NewResourceHandler`
- The tool definitions for `apply_agent` and `delete_agent` lived in separate files (`apply_tool.go`, `delete_tool.go`) despite all three tools sharing the same conceptual home

## Solution

Replaced all mechanical boilerplate with single-line delegations to the T02 shared abstractions, and consolidated the three tool definitions into a single `tools.go`. The curated content (tool names, descriptions, jsonschema annotations, RPC client constructors, error resource descriptors) is unchanged and remains hand-written.

## Implementation Details

### Files Modified

**`fetch.go`** (39 → 30 lines, -23%)

Replaced 7-line connection setup with `domains.WithConnection`. Removed imports of `auth` and `stigmergrpc`; added `grpc` for the closure parameter type.

```go
// Before: 7 lines of ceremony in every domain function
conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
if err != nil { return "", fmt.Errorf("agents.Fetch: %w", err) }
defer conn.Close()
rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
defer cancel()

// After: single delegation, domain code is only what's domain-specific
return domains.WithConnection(ctx, serverAddress,
    func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
        // ... only the RPC call remains
    })
```

**`apply.go`** (40 → 31 lines, -22%)

Same `WithConnection` pattern. Unmarshal intentionally stays outside the closure — failing fast before opening a gRPC connection is the right behavior.

**`delete.go`** (50 → 42 lines, -16%)

Both `GetByReference` and `Delete` RPCs share the single connection provided by `WithConnection`, exactly as they did before. The two-step pattern is preserved with full clarity.

**`resources.go`** (46 → 24 lines, -48%)

The manual 18-line resource handler body became a single call:

```go
func ResourceHandler(serverAddress string) mcp.ResourceHandler {
    return domains.NewResourceHandler(Fetch, serverAddress, "agents")
}
```

Error format `"agents resource: %w"` is preserved identically by `NewResourceHandler`'s `domainName` parameter.

**`tools.go`** (38 → 80 lines, net +42 — absorbed two deleted files)

Each handler body shrunk from 5 lines to 1 line:

```go
// Before
func Handler(serverAddress string) func(...) (*mcp.CallToolResult, any, error) {
    return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetAgentInput) (*mcp.CallToolResult, any, error) {
        text, err := Fetch(ctx, serverAddress, input.Org, input.Slug)
        if err != nil { return nil, nil, err }
        return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil, nil
    }
}

// After
func Handler(serverAddress string) func(...) (*mcp.CallToolResult, any, error) {
    return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetAgentInput) (*mcp.CallToolResult, any, error) {
        return domains.CallFetch(Fetch, ctx, serverAddress, input.Org, input.Slug)
    }
}
```

All three tool definitions (`get_agent`, `apply_agent`, `delete_agent`) now live in one file, organized by clear section comments.

### Files Deleted

- `apply_tool.go` (34 lines) — content merged into `tools.go`
- `delete_tool.go` (35 lines) — content merged into `tools.go`

### No Changes To

- All 4 test files (`tools_test.go`, `apply_tool_test.go`, `delete_tool_test.go`, `resources_test.go`)
- `server.go` — all exported symbol names and signatures are identical
- All curated content: tool names, descriptions, jsonschema field annotations, resource template metadata

### Behavioral Difference: Connection Error Prefixes

The old code wrapped connection failures with `fmt.Errorf("agents.Fetch: %w", ...)`. With `WithConnection`, the raw `stigmergrpc.NewConnection` error surfaces without a domain prefix. This only affects the connection-error path (not RPC errors, which still go through `RPCError`). No tests assert on these prefix strings, and the underlying error is already descriptive. Noted as an accepted trade-off against complicating the `WithConnection` API.

## Benefits

- **Net reduction**: 282 → 207 source lines in the agents package (-26%)
- **Zero mechanical code remains**: every line in the agents package is now either curated (tool descriptions, RPC calls, error descriptors) or a single delegation to a shared abstraction
- **No new imports of `auth` or `stigmergrpc`**: the agents package now only knows about its domain; connection lifecycle is the `domains` package's concern
- **All 12 mcp-server packages pass**: zero test modifications required
- **Clear reference pattern**: T04 domains have an exact, working template to follow

## Impact

This is the reference implementation for the MCP domain refactoring series. Workflows, mcpservers, and skills (T04) will follow exactly this pattern. When the refactoring is complete across all domains, adding a new domain will require ~150 lines of purely curated code with zero copy-paste of mechanical infrastructure.

## Related Work

- `_changelog/2026-02/2026-02-20-145752-mcp-server-shared-abstractions.md` — T02: shared abstractions implemented
- T04 (next): refactor workflows, mcpservers, skills using this same pattern
- T05: full validation pass, verify MCP surface is byte-for-byte identical

---

**Status**: ✅ Production Ready
**Timeline**: Single session, February 20, 2026
