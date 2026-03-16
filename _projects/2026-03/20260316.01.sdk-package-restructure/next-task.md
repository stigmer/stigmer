# Next Task: 20260316.01.sdk-package-restructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260316.01.sdk-package-restructure

**Description**: Restructure Stigmer's SDK and TypeScript packages into a clean architecture: @stigmer/sdk (framework-agnostic TS client), @stigmer/react (consolidated React hooks and embeddable components), @stigmer/theme, and @stigmer/protos. Clean up Go SDK to target only 5 core resources (agent, skill, mcp-server, session, execution). Fix the broken npm release pipeline.
**Goal**: Establish the correct package segregation and release infrastructure so that platform builders can install @stigmer/sdk + @stigmer/react and integrate Stigmer into their products with minimal friction. Clean the Go SDK down to 5 resources with codegen-friendly structure. Evaluate whether codegen applies to TypeScript SDK as well.
**Tech Stack**: TypeScript/React, Go, Protobuf/Buf, npm workspaces, GitHub Actions
**Components**: sdk/go (Go SDK), client-apps/web/_libs/domain (React domain packages), client-apps/web/_libs/infra (rpc-client), scripts/publish-libs.mjs (release script), package.json (workspace config), .github/workflows/release.npm-libs.yaml (CI), apis/stubs/ts (proto stubs)

## Current Status

**Created**: 2026-03-16 09:59
**Last Session**: 2026-03-16 — Completed Go SDK cleanup (Track B of Phase 1)
**Current Task**: Phase 1, Track A (TypeScript SDK) is the next work item
**Status**: Track B complete, Track A not started

## Session Progress (2026-03-16)

### Completed: Go SDK Cleanup (Phase 1, Track B)

- Removed entire Pulumi-style synthesis SDK: `stigmer.Run()`, `stigmer.Context`, manifest writing, `internal/synth/`, `internal/templates/`, all domain packages (`agent/`, `skill/`, `mcpserver/`, `environment/`, `ref/`, `metadata/`, `context/`, `stigmer/`, `workflow/`)
- Removed old codegen outputs: `gen/` directory with Args structs, workflow configs, type files for all resources
- Extended codegen pipeline (`tools/codegen/generator/sdk_client.go`) to generate Stripe-style client code:
  - Resource clients (`AgentClient`, `SkillClient`, `McpServerClient`, `SessionClient`, `AgentExecutionClient`)
  - Input types from spec schemas (`AgentInput`, `SkillInput`, `McpServerInput`, `AgentExecutionInput`) with `toProto()` conversion
  - Shared types (`DeleteResourceInput`, `ResourceRef`, `Page`, `ListParams`, `ListResult`, `EnvSpecInput`, `EnvVarInput`)
  - Error types (`Error`, `ErrorCode`, sentinel checks)
  - CRUD methods (`Create`, `Get`, `GetByReference`, `Update`, `Apply`, `Delete`, `List`)
  - Streaming (`Subscribe` for AgentExecution)
- All generated code lives in `sdk/go/internal/gen/`, wiped and recreated by `make codegen`
- Added transport layer: `sdk/go/internal/transport/` (gRPC dial, API key auth interceptor, TLS)
- Handwritten public surface: `client.go`, `errors.go`, `options.go`, `search.go`, `types.go`
- Root Makefile `protos` target now chains SDK codegen automatically
- New examples: `basic_crud.go`, `error_handling.go`, `search.go`, `streaming_execution.go`
- All builds, vets, and tests pass

### Key Decisions Made

- **Domain naming**: `client.AgentExecution` (not `client.Execution`) — respects ubiquitous language from architect role
- **Singular client fields**: `client.Agent`, `client.Skill` (not plural)
- **Input type naming**: `AgentInput` (not `CreateAgentInput`) — same input used for Create, Update, Apply
- **Generated code segregation**: `internal/gen/` is entirely managed by codegen; public package uses type aliases
- **Hybrid types**: Proto types for responses, custom Go types for inputs (ergonomic + resource-safe)
- **Transport**: gRPC (standard Go gRPC stubs), not Connect-RPC
- **Search/List**: `List()` on each resource client (routes to SearchService or native RPC internally); `client.Search` for cross-resource queries
- **Package structure**: Flat root `stigmer` package with `internal/` sub-packages — standard Go SDK pattern

### Files Modified/Created (key ones)

- `tools/codegen/generator/sdk_client.go` — new, core codegen for SDK clients
- `tools/codegen/generator/main.go` — modified for new target
- `tools/codegen/proto2schema/main.go` — enhanced for service schema extraction
- `sdk/go/internal/gen/*.go` — generated (agent, skill, mcpserver, session, execution, errors, types)
- `sdk/go/internal/transport/*.go` — new (dial, interceptors)
- `sdk/go/internal/validation/*.go` — existing (retained for future use)
- `sdk/go/client.go`, `errors.go`, `options.go`, `search.go`, `types.go` — new handwritten public surface
- `sdk/go/Makefile` — rewritten for new codegen pipeline
- `sdk/go/README.md` — rewritten for Stripe-style SDK
- `Makefile` — updated `protos` target to chain SDK codegen

## Next Steps

1. **Phase 1, Track A: TypeScript SDK (`@stigmer/sdk`)**
   - Create `sdk/typescript/` with framework-agnostic client
   - Evaluate extending codegen pipeline for TypeScript output
   - Design public API surface mirroring Go SDK patterns
2. **Phase 2: Consolidate `@stigmer/react`**
   - Move domain packages into single package with subpath exports
   - CSS Modules + Custom Properties migration
3. **Phase 3: Migrate web console**
4. **Phase 4: Release pipeline + npm cleanup**

## Context for Resume

- The Go SDK codegen pipeline is `proto2schema` (Stage 1: protos → JSON schemas) then `generator` (Stage 2: schemas → Go code)
- `make protos` in root now triggers both proto stub generation AND SDK codegen
- `make codegen-verify` in `sdk/go/` runs full pipeline + build + test
- Session resource has no spec schema — its methods take proto types directly
- `internal/validation/` package exists but is not yet wired into generated `toProto()` methods — future enhancement
- The design decision document at `design-decisions/go-sdk-api-surface.md` captures the full API surface rationale

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.01.sdk-package-restructure/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.01.sdk-package-restructure/tasks/
```

### 3. Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.01.sdk-package-restructure/design-decisions/
```

### 4. Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.01.sdk-package-restructure/coding-guidelines/
```

### 5. Wrong Assumptions / Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.01.sdk-package-restructure/wrong-assumptions/
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260316.01.sdk-package-restructure/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 1, Track A (TypeScript SDK)

## Quick Commands

After loading context:
- "Continue with Phase 1 Track A" — Start TypeScript SDK work
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
