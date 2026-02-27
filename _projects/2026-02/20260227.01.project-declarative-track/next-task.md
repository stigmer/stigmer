# Next Task: 20260227.01.project-declarative-track

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260227.01.project-declarative-track

**Description**: Redesign Project API to use references instead of full embedded objects, and add a declarative directory-scanning mode so users can manage groups of Stigmer resources from a folder with full reconciliation.
**Goal**: Enable users to create a directory with stigmer.yaml (marker) and YAML resource files, run 'stigmer apply', and get automatic resource discovery, individual apply, and server-side reconciliation with orphan pruning — no SDK code required.
**Tech Stack**: Go, Protocol Buffers (buf), gRPC
**Components**: APIs/protos (project spec, status), CLI (apply command, project detection, directory scanning), Backend server (project controller, reconciliation service)

## Current Status

**Created**: 2026-02-27 18:17
**Current Task**: T01 — Phase 1 and Phase 2 complete, ready for Phase 3
**Status**: In Progress

## Session Progress (2026-02-27, Session 2)

### Completed: T01 Phase 2 — Backend Reconciliation Simplification

Replaced the entire ~10,000 LOC reconciliation engine (designed for server-side resource lifecycle with embedded objects, dependency graphs, topological sort) with a ~300 LOC reference-based reconciliation that does set-difference on `ApiResourceReference` members and orphan pruning.

#### Deleted (11 production + 11 test files + README.md)
- `desired_state`, `actual_state`, `diff`, `dependency_graph`, `dependency_discoverer`, `graph_builder`, `execution_order`, `resource_change`, `reconciliation_plan`, `change_type`, `resource_key` — all with their `_test.go` counterparts

#### Rewritten (4 core files)
- `reconciliation_service.go` — `Reconcile(ctx, previousMembers, currentMembers, options)` takes two flat reference lists
- `reconciliation_result.go` — Uses `*ApiResourceReference` for added/removed, with `ToProtoSummary()` mapping
- `execution_engine.go` — Stripped to `ResourceDeleter` interface + `ResourceDeleterAdapter`
- `service.go` — Set-difference + orphan deletion via `ResourceDeleter` + reference resolution via `store.FindByField`

#### Updated (controller + server)
- `apply.go` — Captures previous members before Create/Update, passes both lists to `Reconcile()`
- `project_controller.go` — Updated docs, simplified constructor
- `server.go` — Swapped `ExecutionEngine` for `ResourceDeleterAdapter`

#### Tests (all rewritten)
- `service_test.go` — 15 tests: set-difference, dry-run, orphan deletion, partial failure, stub mode
- `execution_engine_test.go` — Tests for `ResourceDeleterAdapter` routing
- `reconciliation_result_test.go` — Tests for `NewResult`, `EmptyResult`, `ResultBuilder`, `ToProtoSummary`
- Controller tests (7 files) — Removed all `Agents`/`Workflows`/`McpServers`/`Skills`/`Runtime` references, replaced with `Members`

#### Verification
- `bazel build //backend/services/stigmer-server/...` — 66 targets build
- `bazel test //backend/services/stigmer-server/...` — 21 test targets pass

### Previous Session: T01 Phase 1 — Proto API Changes
- Redesigned `ProjectSpec` to reference-based membership model
- Committed as `c2e69995`

### Key Decisions Made
1. `ResourceDeleter` is the only execution interface — no Create/Update on server side
2. Reference resolution via `store.FindByField` for orphan deletion (kind + slug -> resource ID)
3. Stub mode (nil deleter) marks orphans as removed without actually deleting — used by default in tests
4. Partial failure semantics: continue deleting other orphans if one fails, accumulate errors

## Next Steps

1. **Phase 3: CLI Declarative Track** — Add `TrackDeclarative` to track detection, implement directory scanning + individual resource apply + member collection flow.
2. **Phase 4: Adapt SDK Track** — Update `executeProjectApply` to apply resources individually then send references.
3. **Phase 5: Testing** — Unit and integration tests for all three tracks.

## Context for Resume

- Phases 1 and 2 are fully complete — protos redesigned, backend reconciliation simplified
- The CLI `apply_project.go` still assigns synthesized resources to the old `proj.Spec.Agents` etc. fields — these no longer exist in the proto. This will be fixed in Phase 3/4.
- The backend is fully functional: apply a project with `spec.members` and it will track membership, compute added/orphaned, and optionally delete orphans
- `DownstreamClients` and client interfaces (`AgentClient`, `WorkflowClient`, etc.) are unchanged — they're shared with bootstrap

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.01.project-declarative-track/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.01.project-declarative-track/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.01.project-declarative-track/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.01.project-declarative-track/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.01.project-declarative-track/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.01.project-declarative-track/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.01.project-declarative-track/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 3 (CLI Declarative Track)

## Quick Commands

After loading context:
- "Continue with Phase 3" - Start CLI declarative track implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
