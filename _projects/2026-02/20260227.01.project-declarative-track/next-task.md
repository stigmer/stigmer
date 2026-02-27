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
**Current Task**: T01 — Phases 1–5 complete
**Status**: Complete (pending end-to-end verification and PR)

## Session Progress (2026-02-27, Session 5)

### Completed: T01 Phase 5 — Unit Tests for Apply Command

Added comprehensive unit tests for all untested pure functions in `cmd/stigmer/root/` introduced in Phases 3 and 4. The package went from zero apply-related test coverage to 68 new tests across 6 test files.

#### New Test Files Created (6 files)
- `apply_test_helpers_test.go` — Shared test data builders: `newTestProject`, `newTestProjectApplyResult`, `newTestMembers`, `newTestAgentApplyResult`, `newTestWorkflowApplyResult`, `newTestMcpServerApplyResult`, `writeResourceYAML`
- `apply_file_handlers_test.go` (22 tests) — Tests for `buildResourceReference`, `truncateForDisplay`, and all 6 per-resource result builders (agent/workflow/mcpserver, apply+dryrun variants)
- `apply_declarative_test.go` (30 tests) — Tests for `scanResourceFiles` (YAML scanning, stigmer.yaml exclusion, subdirectory skipping), `detectResourceItems` (kind detection, Project skipping, unknown kind errors), `countMembersByKind`, and declarative result builders
- `apply_org_test.go` (12 tests) — Tests for `resolveApplyOrganization` priority chain (flag > yaml > cloud config > local default, error on missing cloud org), `buildAtomicTrackResult`
- `apply_file_test.go` (12 tests) — Tests for `resolveApplyFiles` (file/directory/recursive/non-existent), `detectApplyItems` (kind detection, multi-document YAML)
- `apply_project_result_test.go` (12 tests) — Tests for `buildSDKResult` (created/updated, Mode=SDK, skill-first ordering, reconciliation), `executeSDKDryRun` (rendering, entry-point warning)

#### Modified Files (1 build)
- `root/BUILD.bazel` — Added 6 new test srcs and 8 new test deps

#### Test Helpers Pattern
Created a dedicated `apply_test_helpers_test.go` with reusable builders to avoid proto construction duplication. Also added `requireSectionField` and `findSectionField` assertion helpers for inspecting `CommandResult` sections without brittle string matching.

#### Verification
- `go test ./cmd/stigmer/root/...` — 296 total tests pass (68 new)
- `go test ./internal/cli/apply/...` — all existing tests pass
- `go test ./internal/cli/project/...` — all existing tests pass
- `go build ./cmd/stigmer/` — full CLI binary compiles
- `go vet ./cmd/stigmer/root/...` — clean

### Previous Sessions
- **Session 4**: T01 Phase 4 — Adapt SDK track (committed as `b5c48b55`)
- **Session 3**: T01 Phase 3 — CLI declarative track (committed as `2523ba93`)
- **Session 2**: T01 Phase 2 — Backend reconciliation simplification (committed as `404296eb`)
- **Session 1**: T01 Phase 1 — Proto API redesign (committed as `c2e69995`)

## Next Steps

1. **End-to-end verification** — Manual test of the full `stigmer apply` flow across all three modes (atomic, declarative, SDK) against a running backend
2. **Commit Phase 5 and PR** — Commit the test changes, then create a PR covering the entire T01 task
3. **T02: Documentation** — Update README and docs to reflect the new declarative workflow as the primary getting-started path

## Context for Resume

- All 5 phases of T01 are complete. The `stigmer apply` command supports all three tracks (atomic, declarative, SDK) with unit test coverage for the pure function layer
- The orchestration functions (`executeDeclarativeApply`, `executeProjectApply`, `executeFileApply`) remain untested at the unit level because they hard-code side effects (`config.Load()`, `backend.NewConnection()`, `daemon.EnsureRunning()`). Testing them would require dependency injection refactoring — a separate effort
- Bazel builds are blocked by a pre-existing `com_github_alecthomas_chroma_v2` dependency resolution issue (unrelated to our changes)
- `go test` and `go build` are the verified build/test commands

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
6. [ ] Continue with end-to-end verification or T02

## Quick Commands

After loading context:
- "Run e2e verification" - Test all three apply tracks against running backend
- "Create PR for T01" - Create a pull request for the complete task
- "Start T02" - Begin documentation updates
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
