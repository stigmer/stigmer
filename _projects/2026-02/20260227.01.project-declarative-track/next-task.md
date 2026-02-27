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
**Current Task**: T01 — Phases 1, 2, and 3 complete, ready for Phase 4
**Status**: In Progress

## Session Progress (2026-02-27, Session 3)

### Completed: T01 Phase 3 — CLI Declarative Track

Implemented the full declarative apply flow and fixed all compilation breakage caused by the Phase 1 proto redesign (removal of `ProjectRuntime` enum and embedded resource fields).

#### New File Created
- `apply_declarative.go` — Core declarative flow: scan project directory for YAML resources (excluding stigmer.yaml), detect resource kinds, apply each individually via its own RPC, collect `ApiResourceReference`s, set them as `Project.Spec.Members`, call `project.Apply()` for server-side reconciliation, and render a structured summary result with member counts and reconciliation details.

#### Refactored (8 production files)
- `detect.go` — Added `TrackDeclarative` constant; updated `DetectTrack` to differentiate declarative (no entry_point) from SDK (entry_point set)
- `apply.go` — Three-way routing: `TrackAtomic` (no stigmer.yaml), `TrackDeclarative` (new), `TrackProject` (SDK). Removed dead functions referencing `ProjectRuntime`.
- `apply_project.go` — Replaced with Phase 4 error stub: SDK track returns actionable error directing users to declarative mode
- `apply_file.go` — `applyResourceItem` now returns `(*ApiResourceReference, error)` for reference collection
- `apply_file_handlers.go` — Added `buildResourceReference` helper; `applyAgent/Workflow/McpServer` now return `*ApiResourceReference`
- `display.go` — Rewrote for reference model: shows "Mode: SDK" or "Mode: declarative", displays member counts by `ApiResourceKind`
- `validator.go` — Replaced `validateRuntimeEntryPoint` (referenced deleted enum) with `validateEntryPointExtension` (validates recognized SDK file extensions)
- `applier.go` — Updated doc comments for reference-based reconciliation model

#### Tests Updated (5 files)
- `detect_test.go` — New fixtures for declarative/SDK modes, removed runtime-based tests
- `display_test.go` — Full rewrite: uses `ApiResourceReference` members instead of embedded resources
- `validator_test.go` — Full rewrite: extension-based validation instead of runtime-entrypoint cross-validation
- `loader_test.go` — Removed `runtime` from all YAML fixtures, added `TestLoad_LegacyRuntimeFieldRejected`
- `applier_test.go` — Removed `Runtime` field from test fixtures

#### Build Configuration
- `BUILD.bazel` (root) — Added `apply_declarative.go` to `srcs`

#### Verification
- `go build ./cmd/stigmer/` — CLI binary compiles
- `go test ./internal/cli/project/...` — All tests pass
- `go test ./cmd/stigmer/root/...` — All tests pass

### Known Remaining Issue
- `internal/cli/apply/synthesize.go` + `synthesize_test.go` — SDK synthesis engine references deleted `ProjectRuntime` enum. This code is dead (not imported by the CLI binary since SDK track was stubbed) and will be reworked in Phase 4.

### Previous Sessions
- **Session 2**: T01 Phase 2 — Backend reconciliation simplification (committed as `404296eb`)
- **Session 1**: T01 Phase 1 — Proto API redesign (committed as `c2e69995`)

### Key Decisions Made
1. `scanResourceFiles` scans top-level directory only (files next to stigmer.yaml) — keeps mental model simple
2. `detectResourceItems` silently skips `Project` kind documents — avoids re-applying stigmer.yaml as a resource
3. SDK track returns explicit error in Phase 3 rather than attempting partial adaptation
4. `validateEntryPointExtension` replaces runtime-entrypoint cross-validation — runtime is now inferred from extension
5. Dry-run mode reuses the same per-resource handlers, just skips backend connectivity

## Next Steps

1. **Phase 4: Adapt SDK Track** — Define local `Runtime` type in `apply` package to replace proto enum, update `synthesize.go` to use it, reconnect `executeProjectApply` to individual-resource-then-reference flow.
2. **Phase 5: Testing** — Unit and integration tests for all three tracks.

## Context for Resume

- Phases 1, 2, and 3 are fully complete — protos redesigned, backend reconciliation simplified, CLI declarative track implemented
- The only dead code remaining is `internal/cli/apply/synthesize.go` (SDK synthesis) which references the deleted `ProjectRuntime` enum — Phase 4 will define a local `Runtime` string type to replace it
- The CLI binary compiles and all tests in the affected packages pass
- Bazel builds are blocked by a pre-existing `com_github_alecthomas_chroma_v2` dependency resolution issue (unrelated to our changes)
- The `resolveApplyOrganization` function in `apply.go` handles org from: flag override → stigmer.yaml metadata → CLI context → local fallback

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
6. [ ] Continue with Phase 4 (Adapt SDK Track)

## Quick Commands

After loading context:
- "Continue with Phase 4" - Start SDK track adaptation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
