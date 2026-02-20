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
**Last Session**: February 20, 2026 (Session 8)
**Current Task**: T10 DONE — Generalize MCP codegen to all domains
**Status**: ALL TASKS COMPLETE — branch ready for PR

## Task Overview

| Task | Description | Status |
|---|---|---|
| T01 | Architecture Design — shared abstractions, before/after analysis | DONE |
| T02 | Implement Core Abstractions + rename files to express responsibility | DONE (committed 78691149) |
| T03 | Refactor Agents Domain — reference refactoring | DONE |
| T04 | Refactor Remaining Domains — workflows, mcpservers, skills | DONE |
| T05 | Final Validation and Close-Out | DONE |
| T06 | Agent Apply Rich Schema — SDK-pattern structured input | DONE (committed 12dbcb9c) |
| T07 | MCP Input Type Codegen — generate input types from protos | DONE (committed 225db0b0) |
| T08 | Workflow codegen + toProto error propagation + Makefile | DONE (committed 5ca21143) |
| T09 | Typed workflow task configs — replace `map[string]any` with 13 typed structs | DONE (committed 549482ba) |
| T10 | Generalize MCP codegen to all domains — comprehensive mode + proto custom options | **DONE** |

## T10 Completion Summary (Session 8)

Generalized the MCP server codegen from 3 manually-configured resources to 15 auto-discovered
resources across all 3 domains (agentic, iam, tenancy). A single `make codegen` command now
generates everything. Discriminated union metadata (workflow task configs) is declared in the
proto itself via custom options, eliminating all CLI flags.

**What was done — 6 phases:**

### Phase 1: Proto Custom Options
- Added `discriminated_by` (field option 90205) and `discriminator_value` (message option 90301)
  to `field_options.proto`
- Annotated `WorkflowTask.task_config` with `(discriminated_by) = "kind"`
- Annotated all 13 task config messages with their `discriminator_value`

### Phase 2: proto2schema Enhancement
- Added `DiscriminatedBy` to `FieldSchema` and `DiscriminatorValue` to `TaskConfigSchema`
- Implemented `extractDiscriminatedBy()` and `extractDiscriminatorValue()` via protowire
- Both metadata types extracted and emitted into JSON schemas automatically

### Phase 3+4: Generator Comprehensive Mode + Schema-driven Expand-struct
- Added `--comprehensive` flag to generator
- `discoverDomains()` walks schema root, identifies domain/resource pairs
- `indexSatellites()` loads schemas from non-domain directories (tasks/)
- `detectExpandStructFromSchema()` auto-configures expand-struct from `discriminatedBy` metadata
- No CLI flags needed — generator reads everything from schemas

### Phase 5: Restructured gen/ + Updated Makefile
- Moved existing gen packages to `gen/agentic/{agent,mcpserver,workflow}`
- Updated 9 import references in domain handlers and tests
- Replaced manual multi-line `codegen-mcp` with single comprehensive command
- Added `codegen-schemas` and top-level `codegen` targets

### Phase 6: Generated All Resources + Validated
- 15 resources generated across agentic (10), iam (4), tenancy (1)
- `project` skipped — composite resource that embeds full resource wrappers (naming collision)
- `go build ./...` ✅, `go test -race ./...` ✅, `make vet` ✅

**Generated output:**
```
mcp-server/gen/
  agentic/   agent, agentexecution, agentinstance, environment, executioncontext,
             mcpserver, skill, workflow, workflowexecution, workflowinstance
  iam/       apikey, iampolicy, identityaccount, identityprovider
  tenancy/   organization
```

## Final Architecture Summary

```
Proto definitions (with discriminated_by / discriminator_value custom options)
    ↓  proto2schema --comprehensive
JSON schemas (with discriminatedBy + discriminatorValue metadata)
    ↓  generator --comprehensive --target=mcp
Generated input types (mcp-server/gen/{domain}/{resource}/)
    ↓  ToProto()
Proto messages → gRPC backend

Shared abstractions (mcp-server/internal/domains/):
  conn.go           — gRPC connection + auth metadata
  marshal.go        — protojson serialization
  resourcehandler.go — generic MCP resource handler
  resourceuri.go    — URI template parsing
  toolresult.go     — MCP tool result construction

Shared utilities (mcp-server/internal/convert/):
  convert.go        — GenerateSlug, VisibilityFromString
```

## Essential Files

```
apis/ai/stigmer/commons/apiresource/field_options.proto              — Custom proto options
tools/codegen/generator/main.go                                      — Comprehensive mode, schema-driven expand-struct
tools/codegen/generator/mcp.go                                       — MCP codegen logic
tools/codegen/proto2schema/main.go                                   — Schema extraction with custom options
mcp-server/gen/{domain}/{resource}/                                  — 15 generated packages
mcp-server/Makefile                                                  — codegen / codegen-schemas / codegen-mcp
```

## Known Limitation

`project` resource is skipped from MCP codegen because it's a composite/aggregate type that
embeds full resource wrappers (`Agent`, `Workflow`, `McpServer`, `Skill`). This causes a naming
collision where both `Agent` and `AgentSpec` map to `AgentInput`. When project-level MCP tools
are needed, the generator's naming logic can be enhanced, or tools can be hand-written.

## Quick Commands

- "Run full codegen pipeline" — `cd mcp-server && make codegen`
- "Run schemas only" — `cd mcp-server && make codegen-schemas`
- "Run MCP codegen only" — `cd mcp-server && make codegen-mcp`
- "Run tests" — `cd mcp-server && go test -race ./...`
- "Run vet (hand-written code)" — `cd mcp-server && make vet`

---

*Project complete. Branch `feat/implement-mcp-server-shared-abstractions` is ready for PR.*
