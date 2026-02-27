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
**Current Task**: T01 — Phases 1–4 complete, ready for Phase 5
**Status**: In Progress

## Session Progress (2026-02-27, Session 4)

### Completed: T01 Phase 4 — Adapt SDK Track

Re-enabled the SDK apply track (`executeProjectApply`) by replacing the deleted `ProjectRuntime` proto enum with a local `Runtime` value object, adapting the synthesis engine, and implementing the full orchestration flow: synthesis → push skills → apply resources → collect references → apply project.

#### New Files Created
- `client-apps/cli/internal/cli/apply/runtime.go` — Local `Runtime` string type (`RuntimeGo`, `RuntimePython`, `RuntimeNode`) with `InferRuntime` constructor that derives runtime from entry-point file extension. Replaces the deleted `projectv1.ProjectRuntime` proto enum.
- `client-apps/cli/cmd/stigmer/root/apply_project_result.go` — `executeSDKDryRun` for dry-run previews and `buildSDKResult` for structured output. Extracted from `apply_project.go` to stay within line-count guidelines.

#### Modified Files (4 production, 1 test, 2 build)
- `apply_project.go` — Replaced Phase 3 error stub with full SDK orchestration: `InferRuntime` → `Synthesize` → `establishBackendConnection` → `pushAndApplyResources` (skills via `Push`/`PushRemote`, agents/workflows/MCP servers via `Apply`) → collect `ApiResourceReference`s → `project.Apply()` → render summary
- `synthesize.go` — Updated `SynthesizeOptions.Runtime`, `getRuntimeCommand`, `prepareRuntime`, `formatExecutionError` from proto enum to local `Runtime` type
- `synthesize_test.go` — Rewrote `TestRuntimeFromProtoEnum` into `TestInferRuntime_SupportedExtensions`, `TestInferRuntime_UnrecognizedExtension`, `TestInferRuntime_NoExtension`, `TestGetRuntimeCommand_AllRuntimes`; updated all other tests to use local `Runtime` constants
- `artifact/skill.go` — Added `Slug` field to `SkillArtifactResult`; populated from backend `Push` RPC response `Skill.Metadata.Slug` (needed for `ApiResourceReference` construction)
- `apply/BUILD.bazel` — Added `runtime.go` to srcs, removed `projectv1` dependency
- `root/BUILD.bazel` — Added `apply_project_result.go` to srcs, added `skill/v1` and `artifact` dependencies

#### Key Decisions Made
1. `Runtime` is a local value object (not proto enum) — keeps domain pure, prevents invalid states via `InferRuntime` constructor
2. Skills use `Push`/`PushRemote` (not `Apply`) — skill slug is obtained from the backend response rather than computed locally
3. Relative skill paths from SDK synthesis are resolved against the project directory
4. Extracted `apply_project_result.go` to keep `apply_project.go` within ~280 lines (consistent with `apply_declarative.go` at ~300)

#### Verification
- `go build ./internal/cli/apply/...` — compiles
- `go build ./cmd/stigmer/root/...` — compiles
- `go build ./cmd/stigmer/` — full CLI binary compiles
- `go test ./internal/cli/apply/...` — all tests pass
- `go test ./cmd/stigmer/root/...` — all tests pass
- `go test ./internal/cli/project/...` — all tests pass

### Previous Sessions
- **Session 3**: T01 Phase 3 — CLI declarative track implementation
- **Session 2**: T01 Phase 2 — Backend reconciliation simplification (committed as `404296eb`)
- **Session 1**: T01 Phase 1 — Proto API redesign (committed as `c2e69995`)

## Next Steps

1. **Phase 5: Testing** — Unit and integration tests for all three tracks (atomic, declarative, SDK)
2. **End-to-end verification** — Manual or automated test of the full `stigmer apply` flow across all modes
3. **Commit and PR** — Phases 3 and 4 changes are uncommitted and need to be committed

## Context for Resume

- Phases 1–4 are fully complete. The entire `stigmer apply` command now supports all three tracks: atomic (single file), declarative (directory scanning), and SDK (entry_point synthesis)
- Uncommitted changes span 6 modified files and 2 new files across the `apply` and `root` packages, plus plan files
- The `Slug` field added to `SkillArtifactResult` was discovered as necessary during implementation — skills return their slug from the backend `Push` RPC, and this is the only reliable source for constructing `ApiResourceReference` for skills
- Bazel builds are blocked by a pre-existing `com_github_alecthomas_chroma_v2` dependency resolution issue (unrelated to our changes)
- The `.cursor/plans/phase_4_sdk_track_6263bc88.plan.md` file contains the detailed plan that was followed

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
6. [ ] Continue with Phase 5 (Testing)

## Quick Commands

After loading context:
- "Continue with Phase 5" - Start testing phase
- "Commit phases 3 and 4" - Commit the uncommitted work
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
