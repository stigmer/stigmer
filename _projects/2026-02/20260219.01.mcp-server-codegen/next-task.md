# Next Task: 20260219.01.mcp-server-codegen

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260219.01.mcp-server-codegen

**Description**: Shared Go abstractions that eliminate mechanical MCP server boilerplate, plus a codegen pipeline that generates LLM-friendly input types and ToProto() conversion from proto definitions.
**Goal**: Reduce per-domain boilerplate through shared abstractions + codegen for MCP input types.
**Tech Stack**: Go, modelcontextprotocol/go-sdk, protobuf/protojson, stigmer-codegen
**Location**: `mcp-server/` and `tools/codegen/` in the Stigmer monorepo
**Branch**: `feat/implement-mcp-server-shared-abstractions`

## Current Status

**Created**: February 19, 2026
**Last Session**: February 20, 2026 (Session 5)
**Current Task**: T08 DONE — awaiting commit
**Status**: T08 DONE, T05 READY

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — shared abstractions, before/after analysis | DONE |
| T02 | Implement Core Abstractions + rename files to express responsibility | DONE (committed 78691149) |
| T03 | Refactor Agents Domain — reference refactoring | DONE |
| T04 | Refactor Remaining Domains — workflows, mcpservers, skills | DONE |
| T05 | Final Validation and Close-Out | **READY** |
| T06 | Agent Apply Rich Schema — SDK-pattern structured input | DONE (committed 12dbcb9c) |
| T07 | MCP Input Type Codegen — generate input types from protos | DONE (committed 225db0b0) |
| T08 | Workflow codegen + toProto error propagation + Makefile | **DONE** |

## T08 Completion Summary (Session 5)

Extended the codegen pipeline with enum, struct, and error-returning `toProto()` support. Generated workflow input types and migrated all three domains to consistent patterns.

**What was built:**
- Enhanced `proto2schema` to extract `EnumType` (fully-qualified proto enum names)
- Extended MCP generator with `struct` (→ `map[string]any` via `structpb.NewStruct`) and enum (→ proto enum cast) field support
- Changed all generated `toProto()` methods to return `(proto, error)` — consistent error propagation across all domains
- Generated `mcp-server/gen/workflow/workflow_gen.go` with `WorkflowInput`, `WorkflowTaskInput`, etc.
- Regenerated agent and mcpserver with error-returning signatures
- Rewrote workflow `Apply` to accept `*workflowv1.Workflow` (no more raw JSON)
- Added `codegen-mcp` Makefile target
- Removed dead code: `ApplyFunc`, `CallApply`, `UnmarshalJSON`, `UnmarshalOptions`, `ResourceIdentity` (`input.go` deleted)

**Results:** All 12+ packages pass `go test -race`.

Changelog: `_changelog/2026-02/2026-02-20-185549-workflow-codegen-toproto-errors.md`

## What's Next: T05 (Final Validation and Close-Out)

1. Final review of all changes across the branch
2. Ensure test coverage is adequate
3. Close out the project

## Context for Resume

- All three domains (agent, mcpserver, workflow) now use generated input types with error-returning `ToProto()`
- The `codegen-mcp` Makefile target regenerates all three in one shot
- `go vet` has pre-existing warnings from jsonschema-go's escaped-comma tag convention — not a blocker
- `signal.json` was removed from workflow schema root (it's a task-level type, not a top-level resource)

## Essential Files

```
tools/codegen/generator/mcp.go                                    — MCP codegen logic (struct, enum, error support)
tools/codegen/generator/main.go                                   — TypeSpec with EnumType
tools/codegen/proto2schema/main.go                                — Schema extraction with EnumType
mcp-server/gen/agent/agent_gen.go                                 — Generated AgentInput (error-returning)
mcp-server/gen/mcpserver/mcp_server_gen.go                        — Generated McpServerInput (error-returning)
mcp-server/gen/workflow/workflow_gen.go                            — Generated WorkflowInput (NEW)
mcp-server/internal/convert/convert.go                            — Shared utilities (GenerateSlug, VisibilityFromString)
mcp-server/Makefile                                               — codegen-mcp target
```

## Quick Commands

- "Run codegen for all domains" — `cd mcp-server && make codegen-mcp`
- "Run tests" — `cd mcp-server && go test -race ./...`

---

*To resume: drag this file into chat — `@_projects/2026-02/20260219.01.mcp-server-codegen/next-task.md`*
