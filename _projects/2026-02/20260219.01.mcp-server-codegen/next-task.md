# Next Task: 20260219.01.mcp-server-codegen

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260219.01.mcp-server-codegen

**Description**: Shared Go abstractions that eliminate mechanical MCP server boilerplate while keeping curated tool surfaces hand-written. Replaces the original YAML manifest + code generator approach with reusable helpers in the existing `domains` package.
**Goal**: Reduce per-domain boilerplate from ~280 lines to ~150 lines through shared helpers (`WithConnection`, `TextResult`, `NewResourceHandler`, etc.) — no external tooling, no YAML, no code generation.
**Tech Stack**: Go, modelcontextprotocol/go-sdk, protobuf/protojson
**Location**: `mcp-server/internal/domains/` in the Stigmer monorepo (no separate repo needed).
**Blocked by**: Nothing — can continue immediately.

## Current Status

**Created**: February 19, 2026
**Revised**: February 20, 2026 (shifted from codegen to shared abstractions)
**Current Task**: T03 — Refactor Agents Domain (reference refactoring)
**Status**: T03 READY TO START

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — shared abstractions, before/after analysis | DONE |
| T02 | Implement Core Helpers — `WithConnection`, `TextResult`, `NewResourceHandler` | DONE |
| T03 | Refactor Agents Domain — reference refactoring | Ready |
| T04 | Refactor Remaining Domains — workflows, mcpservers, skills | Pending |
| T05 | Validate and Clean Up — full test suite, verify identical MCP surface | Pending |

## T02 Completion Summary

Implemented 3 helper files with 16 tests (all passing):

| File | Exports | Lines |
|---|---|---|
| `grpchelper.go` | `WithConnection` | 31 |
| `toolhelper.go` | `TextResult`, `CallFetch`, `CallApply`, `FetchFunc`, `ApplyFunc` | 43 |
| `resourcehelper.go` | `NewResourceHandler`, `NewVersionedResourceHandler`, `ResourceResult`, `VersionedFetchFunc` | 55 |
| `grpchelper_test.go` | 3 tests | 56 |
| `toolhelper_test.go` | 6 tests | 106 |
| `resourcehelper_test.go` | 7 tests | 157 |

Full test suite: 12 packages, all passing.

## Key Design Decisions (from T01 revised plan)

1. **Shared abstractions, not code generation** — reusable Go helpers eliminate mechanical boilerplate
2. **Curated descriptions stay in Go code** — tool names, descriptions, input schemas are hand-written next to the implementation
3. **No YAML manifest, no separate repo** — helpers live in the existing `domains` package
4. **No proto annotations** — MCP descriptions are LLM-facing copy, not API docs; proto stays clean
5. **Stigmer-specific for now** — Planton Cloud uses a different SDK; extract shared library later if patterns converge

## What T03 Involves

Refactor the `agents` domain to use the new helpers:

1. **`fetch.go`**: Replace manual gRPC connection boilerplate with `domains.WithConnection`
2. **`apply.go`**: Replace manual gRPC connection boilerplate with `domains.WithConnection`
3. **`delete.go`**: Replace manual gRPC connection boilerplate with `domains.WithConnection`
4. **`tools.go`**: Replace manual `CallToolResult` construction with `domains.CallFetch`
5. **`apply_tool.go`**: Replace manual `CallToolResult` construction with `domains.CallApply`
6. **`delete_tool.go`**: Replace manual `CallToolResult` construction with `domains.CallFetch`
7. **`resources.go`**: Replace manual resource handler with `domains.NewResourceHandler`
8. **Verify**: All existing tests pass without modification (same tool names, descriptions, error messages)

Expected outcome: ~278 lines → ~150 lines, with zero behavioral changes.

## Research Reference

Research report: `_projects/2026-02/20260217.01.stigmer-mcp-server/research/20260219.160000.proto-to-mcp-server-codegen/`

## Essential Files

```
_projects/2026-02/20260219.01.mcp-server-codegen/tasks/T01_0_plan.md  — Original architecture design (superseded)
_projects/2026-02/20260219.01.mcp-server-codegen/tasks/T01_1_revised_plan.md — Revised plan: shared abstractions (APPROVED)
mcp-server/internal/domains/grpchelper.go                              — WithConnection (T02)
mcp-server/internal/domains/toolhelper.go                              — TextResult, CallFetch, CallApply (T02)
mcp-server/internal/domains/resourcehelper.go                          — NewResourceHandler, ResourceResult (T02)
mcp-server/internal/domains/agents/                                     — Reference domain (will be refactored in T03)
mcp-server/internal/server/server.go                                    — Registration (unchanged)
```

## Quick Commands

- "Start T03" — Refactor agents domain to use shared helpers
- "Show before/after" — See concrete code comparison for agents domain
- "Run tests" — `go test ./mcp-server/... -count=1`

---

*To resume: drag this file into chat — `@_projects/2026-02/20260219.01.mcp-server-codegen/next-task.md`*
