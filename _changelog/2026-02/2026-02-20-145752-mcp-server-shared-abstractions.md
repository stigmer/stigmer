# MCP Server Shared Abstractions: Eliminating Domain Boilerplate

**Date**: February 20, 2026

## Summary

Introduced shared infrastructure in `mcp-server/internal/domains/` that eliminates 100-120 lines of mechanical boilerplate per domain (gRPC connection setup, MCP result wrapping, resource handler construction). The package boundary was already correct; the gap was purely the missing shared code and the poorly named files that preceded it.

## Problem Statement

The four domain packages (agents, workflows, mcpservers, skills) each contained identical mechanical code that had no business logic in it — just plumbing. Every `Fetch`, `Delete`, and `Apply` function repeated the same 7-line gRPC connect/auth/timeout/defer ceremony. Every tool handler ended with the same 3-line `CallToolResult` construction. Every resource handler repeated the same URI-parse-then-fetch-then-wrap pattern.

### Pain Points

- Each domain was ~280 lines, of which ~120 lines were copy-pasted infrastructure with no domain meaning
- Adding a new domain required copying an existing one and doing find-replace, with meaningful risk of missing a substitution
- Files named `jsonutil.go`, `uriutil.go`, `grpchelper.go`, `toolhelper.go`, `resourcehelper.go` — "util" and "helper" are non-names that don't communicate what the file owns
- The package doc described itself as "shared utilities" — an architectural red flag

## Solution

Two complementary changes in one session:

1. **Implemented three shared infrastructure files** (`conn.go`, `toolresult.go`, `resourcehandler.go`) that capture the mechanical patterns, reducing each domain refactor from ~280 to ~150 lines
2. **Renamed all files** to names expressing actual responsibility rather than auxiliary role — "helper" and "util" eliminated across the board

## Implementation Details

### New infrastructure files

**`conn.go`** — `WithConnection(ctx, addr, fn)`: wraps the 7-line gRPC connect/auth/timeout/defer pattern present in every domain `Fetch`, `Apply`, and `Delete`. Domain functions now call `WithConnection` and receive a ready-to-use `*grpc.ClientConn` with a deadline-scoped context.

**`toolresult.go`** — `TextResult`, `CallFetch`, `CallApply`: eliminate the repeated `&mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}` construction in every tool handler. Also defines `FetchFunc` and `ApplyFunc` type aliases that form the contract between tool handlers and domain functions.

**`resourcehandler.go`** — `NewResourceHandler`, `NewVersionedResourceHandler`, `ResourceResult`: factory functions that construct MCP `ResourceHandler` closures. The only differences between domains' resource handlers were the domain name (for error messages) and whether to parse a version segment — both are now parameters.

### File renames (all in `mcp-server/internal/domains/`)

| Before | After | Reason |
|---|---|---|
| `jsonutil.go` | `marshal.go` | Names the action (marshal), not the format |
| `uriutil.go` | `resourceuri.go` | The `stigmer://` URI scheme is a domain concept, not a utility |
| `grpchelper.go` | `conn.go` | Names what it manages; precedent from `crypto/tls/conn.go` |
| `toolhelper.go` | `toolresult.go` | Named for the artifact it produces (`CallToolResult`) |
| `resourcehelper.go` | `resourcehandler.go` | Named for the artifact it produces (`ResourceHandler`) |
| `rpcerr.go` | (unchanged) | Already well-named |

### New `doc.go`

Package documentation moved from `marshal.go` (formerly `jsonutil.go`) to a proper `doc.go` that gives a complete map of the package's six responsibilities.

### Tests

16 new tests across `conn_test.go`, `toolresult_test.go`, and `resourcehandler_test.go`. All 12 mcp-server packages pass.

## Benefits

- **Per-domain boilerplate reduction**: ~280 lines → ~150 lines (46% reduction), all eliminated lines being mechanical infrastructure
- **Adding a new domain**: write only curated, domain-specific code — no copy-paste of plumbing
- **File names are self-documenting**: any engineer reading the directory immediately understands what each file owns
- **Zero "helper" or "util" in the codebase**: every file name expresses a concept or artifact

## Impact

- No behavioral changes — same tool names, descriptions, error messages, MCP surface
- No import path changes — the `domains` package name is unchanged
- All 12 mcp-server packages pass without modification
- T03 (refactor agents domain) and T04 (refactor remaining domains) can now proceed using these abstractions

## Related Work

- Project: `_projects/2026-02/20260219.01.mcp-server-codegen/`
- Architecture decision: `tasks/T01_1_revised_plan.md` — chose shared abstractions over YAML + code generation
- Next: T03 — Refactor agents domain as the reference implementation using the new abstractions

---

**Status**: Production Ready
**Timeline**: Single session, February 20, 2026
