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
**Current Task**: T05 — Final Validation and Close-Out
**Status**: T05 READY TO START

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — shared abstractions, before/after analysis | DONE |
| T02 | Implement Core Abstractions + rename files to express responsibility | DONE (committed 78691149) |
| T03 | Refactor Agents Domain — reference refactoring | DONE (committed this session) |
| T04 | Refactor Remaining Domains — workflows, mcpservers, skills | DONE (committed this session) |
| T05 | Final Validation and Close-Out | **NEXT** |

## T04 Completion Summary

Refactored the three remaining MCP server domains to use shared abstractions:

**workflows/**
- `fetch.go`, `apply.go`, `delete.go` — replaced 7-line gRPC boilerplate with `domains.WithConnection`
- `resources.go` — replaced 20-line inline closure with `domains.NewResourceHandler`
- `tools.go` — absorbed `apply_tool.go` and `delete_tool.go` (both deleted); replaced manual `CallToolResult` construction with `domains.CallFetch`/`domains.CallApply`

**mcpservers/**
- Same pattern as workflows; `ApiResourceDeleteInput` preserved in `delete.go` (deliberate protobuf API difference)
- `apply_tool.go` and `delete_tool.go` deleted (absorbed into `tools.go`)

**skills/**
- No apply operation; `Fetch` has versioned signature (`org, slug, version`)
- `fetch.go`, `delete.go` — `WithConnection` pattern
- `resources.go` — adapter closure pins `version=""` for `NewResourceHandler`; `NewVersionedResourceHandler(Fetch, ...)` for versioned template
- `tools.go` — get handler uses `domains.TextResult`; delete handler uses `domains.CallFetch`; absorbed `delete_tool.go` (deleted)

**Net**: ~684 → ~500 source lines across the three domains (-27%); 5 files deleted; zero test file changes; all 12 packages pass; `go vet` clean

Changelog: `_changelog/2026-02/2026-02-20-153626-mcp-server-remaining-domains-refactor.md`

## What T05 Involves

T05 is a close-out task — no code changes expected, purely verification and documentation:

1. **Full suite verification**: `go test ./mcp-server/... -count=1 -race` with race detector
2. **Structural audit**: Confirm all four domains have identical file layouts (`fetch.go`, `apply.go`/N/A, `delete.go`, `resources.go`, `tools.go`)
3. **Surface audit**: Confirm `server.go` tool/resource registration is unchanged — same tool names, same URIs, same counts
4. **Boilerplate audit**: Confirm zero `stigmergrpc.NewConnection` or `auth.APIKey` calls remain in any domain `fetch/apply/delete.go`
5. **Project documentation**: Update T01 architecture doc with actual achieved line counts vs projected
6. **Create PR**: Branch is ready — open the pull request

## Key Design Decisions

1. **Shared abstractions, not code generation** — reusable Go infrastructure in the `domains` package
2. **File names express responsibility** — no "helper" or "util" in the codebase
3. **Curated tool descriptions stay hand-written** — next to the handler, in the domain package
4. **No behavioral changes in any refactoring step** — tests verify this at each T
5. **Skills asymmetry handled minimally** — adapter closure for non-versioned handler; `TextResult` for get tool. No new shared helper for a single call site.

## Achieved vs Projected

| Metric | Projected | Achieved |
|---|---|---|
| T04 line reduction | -390 lines | -184 lines (-27%) |
| Combined T02+T03+T04 | ~-400 lines total | ~-400 lines total |
| Test changes | Zero | Zero |
| New shared helpers needed | Zero | Zero |

Note: The per-T04-domain projection of -130 lines each was aggressive; actual averages -61 lines/domain. The combined project total still hits the goal.

## Essential Files

```
_projects/2026-02/20260219.01.mcp-server-codegen/tasks/T01_1_revised_plan.md  — Architecture (APPROVED)
_changelog/2026-02/2026-02-20-145752-mcp-server-shared-abstractions.md        — T02 changelog
_changelog/2026-02/2026-02-20-151441-mcp-server-agents-domain-refactor.md    — T03 changelog
_changelog/2026-02/2026-02-20-153626-mcp-server-remaining-domains-refactor.md — T04 changelog
mcp-server/internal/domains/                                                    — Shared infrastructure
mcp-server/internal/domains/agents/                                             — Reference domain (DONE)
mcp-server/internal/domains/workflows/                                          — DONE
mcp-server/internal/domains/mcpservers/                                         — DONE
mcp-server/internal/domains/skills/                                             — DONE
mcp-server/internal/server/server.go                                            — Registration (unchanged)
```

## Quick Commands

- "Start T05" — Final validation pass and create PR
- "Run tests" — `go test ./mcp-server/... -count=1`
- "Run with race" — `go test ./mcp-server/... -count=1 -race`

---

*To resume: drag this file into chat — `@_projects/2026-02/20260219.01.mcp-server-codegen/next-task.md`*
