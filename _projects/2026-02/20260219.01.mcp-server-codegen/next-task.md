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
**Current Task**: T04 — Refactor Remaining Domains (workflows, mcpservers, skills)
**Status**: T04 READY TO START

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — shared abstractions, before/after analysis | DONE |
| T02 | Implement Core Abstractions + rename files to express responsibility | DONE (committed 78691149) |
| T03 | Refactor Agents Domain — reference refactoring | DONE (committed this session) |
| T04 | Refactor Remaining Domains — workflows, mcpservers, skills | **NEXT** |
| T05 | Validate and Clean Up — full test suite, verify identical MCP surface | Pending |

## T03 Completion Summary

Refactored `mcp-server/internal/domains/agents/` to use shared abstractions:

- `fetch.go`, `apply.go`, `delete.go` — replaced 7-line gRPC boilerplate with `domains.WithConnection`
- `resources.go` — replaced 18-line manual handler with `domains.NewResourceHandler`
- `tools.go` — replaced 5-line `CallToolResult` constructors with `domains.CallFetch`/`domains.CallApply`; absorbed `apply_tool.go` and `delete_tool.go` (both deleted)
- Net: 282 → 207 source lines (-26%), zero test files changed, all 12 packages pass

Changelog: `_changelog/2026-02/2026-02-20-151441-mcp-server-agents-domain-refactor.md`

## What T04 Involves

Refactor the three remaining domains using the agents domain as the exact reference pattern:

| Domain | Files to Change | Notes |
|---|---|---|
| `workflows/` | fetch, apply, delete, tools (merge), resources | Same pattern as agents |
| `mcpservers/` | fetch, apply, delete, tools (merge), resources | Same pattern as agents |
| `skills/` | fetch, delete, tools (merge), resources | No apply; uses `NewVersionedResourceHandler` for versioned resource |

**Success criteria**: All existing tests pass without modification. Same tool names, descriptions, error messages.
**Expected outcome**: ~280 lines × 3 domains → ~150 lines × 3 domains (-390 lines net).

## Key Design Decisions

1. **Shared abstractions, not code generation** — reusable Go infrastructure in the `domains` package
2. **File names express responsibility** — no "helper" or "util" in the codebase
3. **Curated tool descriptions stay hand-written** — next to the handler, in the domain package
4. **No behavioral changes in any refactoring step** — tests verify this at each T

## Essential Files

```
_projects/2026-02/20260219.01.mcp-server-codegen/tasks/T01_1_revised_plan.md  — Architecture (APPROVED)
_changelog/2026-02/2026-02-20-145752-mcp-server-shared-abstractions.md        — T02 changelog
_changelog/2026-02/2026-02-20-151441-mcp-server-agents-domain-refactor.md    — T03 changelog
mcp-server/internal/domains/                                                    — Shared infrastructure
mcp-server/internal/domains/agents/                                             — Reference domain (DONE)
mcp-server/internal/domains/workflows/                                          — T04 target
mcp-server/internal/domains/mcpservers/                                         — T04 target
mcp-server/internal/domains/skills/                                             — T04 target (versioned)
mcp-server/internal/server/server.go                                            — Registration (unchanged)
```

## Quick Commands

- "Start T04" — Refactor workflows, mcpservers, skills domains
- "Run tests" — `go test ./mcp-server/... -count=1`

---

*To resume: drag this file into chat — `@_projects/2026-02/20260219.01.mcp-server-codegen/next-task.md`*
