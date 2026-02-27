---
name: Phase 5 Unit Tests
overview: Add comprehensive unit tests for all untested pure functions introduced in Phases 3 and 4 of the apply command, organized as one test file per production file in `cmd/stigmer/root/`.
todos:
  - id: helpers
    content: Create apply_test_helpers_test.go with shared test data builders (createTestApplyProject, createTestApplyResult, createTestMembers, writeResourceYAML)
    status: completed
  - id: file-handlers
    content: Create apply_file_handlers_test.go -- tests for buildResourceReference, truncateForDisplay, and all 6 per-resource result builders
    status: completed
  - id: declarative
    content: Create apply_declarative_test.go -- tests for scanResourceFiles, detectResourceItems, countMembersByKind, and declarative result builders
    status: completed
  - id: org
    content: Create apply_org_test.go -- tests for resolveApplyOrganization priority chain and buildAtomicTrackResult
    status: completed
  - id: file
    content: Create apply_file_test.go -- tests for resolveApplyFiles and detectApplyItems
    status: completed
  - id: sdk-result
    content: Create apply_project_result_test.go -- tests for buildSDKResult and executeSDKDryRun
    status: completed
  - id: bazel
    content: Update BUILD.bazel with all new test files and dependencies
    status: completed
  - id: verify
    content: Run go test and go build to verify everything compiles and passes
    status: completed
isProject: false
---

# Phase 5: Unit Tests for Apply Command

## Current State

The `cmd/stigmer/root/` package has **zero test coverage** for apply-related code. Five production files with ~980 lines of apply logic have no companion tests:

- `apply.go` (170 lines) -- org resolution, atomic result
- `apply_declarative.go` (299 lines) -- directory scanning, kind detection, result builders
- `apply_file.go` (185 lines) -- file resolution, kind detection
- `apply_file_handlers.go` (235 lines) -- resource reference builder, per-resource result builders, truncation
- `apply_project_result.go` (94 lines) -- SDK dry-run, SDK result builder

Meanwhile, the internal packages are well-covered: `project/` has 7 test files, `apply/` has 2 test files.

## What We Test (and Why)

We focus on **pure functions** and **filesystem-only functions** -- the functions that take inputs and return outputs without needing a running backend. These are the bulk of the untested Phases 3+4 code.

**Not in scope:** The orchestration functions (`executeDeclarativeApply`, `executeProjectApply`, `executeFileApply`) call `config.Load()`, `backend.NewConnection()`, `daemon.EnsureRunning()` -- hard-coded side effects. Testing them requires either dependency injection refactoring or a running backend. That is a separate effort.

## Test File Organization

One test file per production file, following the existing convention across the project (e.g., `detect.go` -> `detect_test.go`).

### 1. `apply_file_handlers_test.go` -- for [apply_file_handlers.go](client-apps/cli/cmd/stigmer/root/apply_file_handlers.go)

Pure functions, no filesystem. Fastest to write, highest confidence.

- `TestBuildResourceReference` -- verify org/kind/slug populated correctly, verify nil metadata panics (documenting the contract)
- `TestTruncateForDisplay` -- within limit, at limit, over limit, maxLen <= 3, empty string
- `TestBuildAgentApplyResult` / `TestBuildAgentDryRunResult` -- created vs updated action text, fields populated, spec fields (description, instructions, MCP servers, skills, sub-agents)
- `TestBuildWorkflowApplyResult` / `TestBuildWorkflowDryRunResult` -- same pattern, task counts, document version
- `TestBuildMcpServerApplyResult` / `TestBuildMcpServerDryRunResult` -- stdio vs HTTP type, tags display

Test data: construct proto structs inline (following the pattern from `project/display_test.go`).

### 2. `apply_declarative_test.go` -- for [apply_declarative.go](client-apps/cli/cmd/stigmer/root/apply_declarative.go)

Filesystem scanning + pure functions. Uses `t.TempDir()`.

- `TestScanResourceFiles` -- finds .yaml/.yml, excludes stigmer.yaml (case-insensitive), skips non-YAML, skips subdirectories, empty directory, non-existent directory error
- `TestDetectResourceItems` -- valid agent+workflow YAML files, skips Project kind, unknown kind error, unsupported verb error, multi-document YAML
- `TestCountMembersByKind` -- nil slice, empty slice, single kind, multiple kinds, all kinds
- `TestBuildDeclarativeResult` -- created vs updated, member counts by kind, reconciliation summary (created/updated/deleted), no reconciliation, empty members
- `TestBuildNoResourcesResult` -- contains directory path and guidance
- `TestBuildDryRunSummary` -- contains resource count and hint

Test data for `detectResourceItems`: create minimal valid YAML files in temp dirs. Reuse the YAML patterns visible in `project/loader_test.go` (e.g., `apiVersion: agentic.stigmer.ai/v1`, `kind: Agent`, etc.).

### 3. `apply_test_helpers_test.go` -- shared test data builders

Extend the existing `test_helpers_test.go` with apply-specific helpers:

- `createTestApplyProject(name string)` -- builds a `*projectv1.Project` with metadata+spec
- `createTestApplyResult(name, slug string, created bool)` -- builds a `*project.ApplyResult`
- `createTestMembers(kinds ...apiresourcekind.ApiResourceKind)` -- builds member refs
- `writeResourceYAML(t, dir, filename, kind, name string)` -- writes a minimal valid YAML resource file to disk

These helpers avoid duplicating proto construction across multiple test files.

### 4. `apply_org_test.go` -- for the org resolution in [apply.go](client-apps/cli/cmd/stigmer/root/apply.go)

- `TestResolveApplyOrganization` -- table-driven test covering the priority chain:
  - Flag override wins over everything
  - Project metadata.org used when no flag
  - Cloud config org used when no flag, no project org
  - Cloud mode with no org anywhere returns error with guidance
  - Local mode returns "local" as default
  - Verify stderr messages for each path (using captured stderr)
- `TestBuildAtomicTrackResult` -- result contains warning, guidance, and hint

### 5. `apply_file_test.go` -- for [apply_file.go](client-apps/cli/cmd/stigmer/root/apply_file.go)

Filesystem functions. Uses `t.TempDir()`.

- `TestResolveApplyFiles` -- single file returns that file, directory returns all YAML/YML files recursively, non-existent path error, file with non-YAML extension
- `TestDetectApplyItems` -- valid agent YAML, valid workflow YAML, unknown kind error, unsupported verb error, multi-document YAML with mixed kinds

### 6. `apply_project_result_test.go` -- for [apply_project_result.go](client-apps/cli/cmd/stigmer/root/apply_project_result.go)

- `TestBuildSDKResult` -- created vs updated, Mode field set to "SDK", member counts (skills first per kind order), reconciliation summary, empty members
- `TestExecuteSDKDryRun` -- renders project name/entry-point/runtime, warns when entry point file missing, no error returned, works with buffer renderer

## BUILD.bazel Updates

Add all new test files to `srcs` in the existing `go_test` rule in [cmd/stigmer/root/BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel). Add test deps:

- `//apis/stubs/go/ai/stigmer/agentic/agent/v1:agent`
- `//apis/stubs/go/ai/stigmer/agentic/workflow/v1:workflow`
- `//apis/stubs/go/ai/stigmer/agentic/mcpserver/v1:mcpserver`
- `//apis/stubs/go/ai/stigmer/agentic/project/v1:project`
- `//apis/stubs/go/ai/stigmer/commons/apiresource`
- `//client-apps/cli/internal/cli/apply` (for `apply.Runtime` in SDK dry-run test)
- `//client-apps/cli/internal/cli/project` (for `project.ApplyResult`, `project.DetectResult`)

## Verification

- `go test ./cmd/stigmer/root/...` -- all new + existing tests pass
- `go test ./internal/cli/apply/...` -- existing tests still pass
- `go test ./internal/cli/project/...` -- existing tests still pass
- `go build ./cmd/stigmer/` -- full CLI binary compiles

## Execution Approach

Work one test file at a time. After each file: compile, run tests, fix any issues before moving on. This keeps the feedback loop tight and avoids cascading errors.
