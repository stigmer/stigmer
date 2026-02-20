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
**Last Session**: February 20, 2026 (Session 4)
**Current Task**: T08 — Generate workflow input types + Makefile integration
**Status**: T07 DONE, T08 READY TO START

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — shared abstractions, before/after analysis | DONE |
| T02 | Implement Core Abstractions + rename files to express responsibility | DONE (committed 78691149) |
| T03 | Refactor Agents Domain — reference refactoring | DONE |
| T04 | Refactor Remaining Domains — workflows, mcpservers, skills | DONE |
| T05 | Final Validation and Close-Out | READY |
| T06 | Agent Apply Rich Schema — SDK-pattern structured input | DONE (committed 12dbcb9c) |
| T07 | MCP Input Type Codegen — generate input types from protos | **DONE** |
| T08 | Workflow codegen + Makefile integration | **NEXT** |

## T07 Completion Summary (Session 4)

Built end-to-end MCP input type codegen pipeline that replaces hand-written boilerplate with generated code.

**What was built:**
- Enhanced `proto2schema` to extract `reference_kind` (typed as `ApiResourceKind` enum) and `oneof` metadata
- Added `reference_kind` field option to `field_options.proto`
- Created `tools/codegen/generator/mcp.go` — MCP-specific code generation logic
- Generated input types for `agent` and `mcpserver` domains
- Created `mcp-server/internal/convert/convert.go` — shared utilities (GenerateSlug, VisibilityFromString)
- Deleted hand-written `agents/input.go` and `agents/convert.go`
- Updated all handlers and tests to use generated types

**Naming conventions refined:**
- Singular package names: `gen/agent/`, `gen/mcpserver/`
- Simple struct names: `AgentInput`, `McpServerInput`
- Simple file names: `agent_gen.go`, `mcp_server_gen.go`
- Generated code has zero dependency on `internal/domains`
- Hand-written utilities in `internal/convert/`, not `gen/`

**Results:** All tests pass across 12 packages.

Changelog: `_changelog/2026-02/2026-02-20-181518-mcp-server-input-type-codegen.md`

## What T08 Involves

1. **Generate workflow input types**: Handle `google.protobuf.Struct` for `task_config` field (currently opaque)
2. **Update workflow handler**: Replace raw JSON string input with generated `WorkflowInput`
3. **Add Makefile target**: `codegen-mcp` target in `mcp-server/Makefile` to regenerate all MCP input types
4. **Clean up `domains/input.go`**: Once workflows is migrated, `ResourceIdentity` can be removed (only workflows still uses it)

## Context for Resume

- Generator handles `reference_kind`, `oneof`, nested messages, maps, arrays, scalar fields
- `google.protobuf.Struct` (used by `WorkflowSpec.tasks[].task_config`) was explicitly deferred — needs a design decision for how to expose it (raw map? typed per-task-type?)
- The `identityFieldNames` dedup in the generator prevents collisions when spec fields overlap with identity fields (e.g., McpServerSpec's `tags`)
- `proto2schema` binary at `tools/proto2schema` was rebuilt but the binary is not committed (it's in `.gitignore`)

## Essential Files

```
tools/codegen/generator/mcp.go                                    — MCP codegen logic
tools/codegen/generator/main.go                                   — --target=mcp entry point
tools/codegen/proto2schema/main.go                                — Schema extraction with referenceKind + oneofGroup
mcp-server/gen/agent/agent_gen.go                                 — Generated AgentInput
mcp-server/gen/mcpserver/mcp_server_gen.go                        — Generated McpServerInput
mcp-server/internal/convert/convert.go                            — Shared utilities (GenerateSlug, VisibilityFromString)
apis/ai/stigmer/commons/apiresource/field_options.proto           — reference_kind option definition
apis/ai/stigmer/agentic/agent/v1/spec.proto                      — Annotated with reference_kind values
_changelog/2026-02/2026-02-20-181518-mcp-server-input-type-codegen.md — T07 changelog
```

## Quick Commands

- "Start T08" — Generate workflow types, add Makefile target
- "Regenerate agent types" — `go run ./tools/codegen/generator/ --schema-dir=tools/codegen/schemas/agentic/agent --output-dir=mcp-server/gen/agent --package=agent --target=mcp`
- "Regenerate mcpserver types" — `go run ./tools/codegen/generator/ --schema-dir=tools/codegen/schemas/agentic/mcpserver --output-dir=mcp-server/gen/mcpserver --package=mcpserver --target=mcp`
- "Run tests" — `cd mcp-server && go test ./...`

---

*To resume: drag this file into chat — `@_projects/2026-02/20260219.01.mcp-server-codegen/next-task.md`*
