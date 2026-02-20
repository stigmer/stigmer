# Next Task: 20260219.01.mcp-server-codegen

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260219.01.mcp-server-codegen

**Description**: Shared Go abstractions that eliminate mechanical MCP server boilerplate while keeping curated tool surfaces hand-written. Replaces the original YAML manifest + code generator approach with reusable helpers in the existing `domains` package.
**Goal**: Reduce per-domain boilerplate from ~280 lines to ~150 lines through shared abstractions — no external tooling, no YAML, no code generation.
**Tech Stack**: Go, modelcontextprotocol/go-sdk, protobuf/protojson
**Location**: `mcp-server/internal/domains/` in the Stigmer monorepo (no separate repo needed).
**Branch**: `feat/implement-mcp-server-shared-abstractions`

## Current Status

**Created**: February 19, 2026
**Last Session**: February 20, 2026
**Current Task**: T03 — Refactor Agents Domain (reference refactoring)
**Status**: T03 READY TO START

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — shared abstractions, before/after analysis | DONE |
| T02 | Implement Core Abstractions + rename files to express responsibility | DONE (committed 78691149) |
| T03 | Refactor Agents Domain — reference refactoring | **NEXT** |
| T04 | Refactor Remaining Domains — workflows, mcpservers, skills | Pending |
| T05 | Validate and Clean Up — full test suite, verify identical MCP surface | Pending |

## T02 Completion Summary

Committed `78691149`. Three new abstraction files, all file renames complete:

```
mcp-server/internal/domains/
  doc.go              -- package documentation
  conn.go             -- WithConnection (gRPC connection lifecycle)
  marshal.go          -- MarshalJSON, UnmarshalJSON (was jsonutil.go)
  rpcerr.go           -- RPCError (gRPC error translation) — unchanged
  resourceuri.go      -- ParseResourceURI, BuildResourceURI (was uriutil.go)
  toolresult.go       -- TextResult, CallFetch, CallApply
  resourcehandler.go  -- NewResourceHandler, NewVersionedResourceHandler, ResourceResult
```

16 new tests, all 12 mcp-server packages pass.

## What T03 Involves

Refactor `mcp-server/internal/domains/agents/` to use the new abstractions. This is the **reference refactoring** — establishes the pattern for T04.

Expected changes per file:

| File | Change |
|---|---|
| `fetch.go` | Replace manual gRPC boilerplate with `domains.WithConnection` |
| `apply.go` | Replace manual gRPC boilerplate with `domains.WithConnection` |
| `delete.go` | Replace manual gRPC boilerplate with `domains.WithConnection` |
| `tools.go` | Replace `CallToolResult` construction with `domains.CallFetch` |
| `apply_tool.go` | Replace `CallToolResult` construction with `domains.CallApply` |
| `delete_tool.go` | Replace `CallToolResult` construction with `domains.CallFetch` |
| `resources.go` | Replace manual handler with `domains.NewResourceHandler` |

**Success criteria**: All existing agent tests pass without modification. Same tool names, descriptions, error messages.
**Expected outcome**: ~278 lines → ~150 lines.

## Key Design Decisions

1. **Shared abstractions, not code generation** — reusable Go infrastructure in the `domains` package
2. **File names express responsibility** — no "helper" or "util" in the codebase
3. **Curated tool descriptions stay hand-written** — next to the handler, in the domain package
4. **No behavioral changes in any refactoring step** — tests verify this at each T

## Essential Files

```
_projects/2026-02/20260219.01.mcp-server-codegen/tasks/T01_1_revised_plan.md  — Architecture (APPROVED)
_changelog/2026-02/2026-02-20-145752-mcp-server-shared-abstractions.md        — T02 changelog
mcp-server/internal/domains/                                                    — Shared infrastructure
mcp-server/internal/domains/agents/                                             — Reference domain (T03)
mcp-server/internal/server/server.go                                            — Registration (unchanged)
```

## Quick Commands

- "Start T03" — Refactor agents domain to use shared abstractions
- "Run tests" — `go test ./mcp-server/... -count=1`

---

*To resume: drag this file into chat — `@_projects/2026-02/20260219.01.mcp-server-codegen/next-task.md`*
