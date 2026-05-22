# Delete Legacy Runners and Migrate Integration Harness to Unified Runner

**Date**: May 21, 2026

## Summary

Deleted all three legacy runner services (Python agent-runner, TypeScript cursor-runner, Go workflow-runner), the graphton Python library, CLI embedded copies, and stale documentation. Migrated the integration test harness to start a single unified runner process instead of three separate ones. 1,569 files changed, 322,572 lines deleted.

## Problem Statement

The codebase carried three legacy runner services that had been fully superseded by the unified TypeScript runner at `backend/services/runner/`. The integration test suite still bootstrapped all three legacy runners, the CLI daemon still embedded and bootstrapped from them, and stale documentation and codegen artifacts referenced the deleted Runner API.

### Pain Points

- Three dead runner directories (~330 source files) cluttered the repo and confused onboarding
- The integration test `suite_test.go` started three separate processes (workflow-runner Go binary, agent-runner Python process, cursor-runner Node.js process) when one unified runner handles all activities
- CLI daemon bootstrap code imported deleted `embedded/agentrunner` and `embedded/cursorrunner` packages
- `go.work` and `Makefile` referenced the deleted workflow-runner Go module
- Stale docs, codegen schemas, and MCP generated code referenced the deleted Runner API

## Solution

One-shot cleanup: delete legacy code, migrate the test harness, rewrite CLI daemon bootstrap, and clean all stale artifacts.

## Implementation Details

### Phase 1: Delete legacy code

- **Deleted**: `backend/services/agent-runner/` (132 Python source files)
- **Deleted**: `backend/services/cursor-runner/` (56 TypeScript source files)
- **Deleted**: `backend/services/workflow-runner/` (142 Go source files)
- **Deleted**: `backend/libs/python/graphton/` (Python agent framework)
- **Deleted**: `client-apps/cli/embedded/agentrunner/` (694 files)
- **Deleted**: `client-apps/cli/embedded/cursorrunner/` (1,068 files)
- **Updated**: `go.work` removed workflow-runner module
- **Updated**: `Makefile` removed GO_MODULES entry, AGENT_RUNNER_DIR/CURSOR_RUNNER_DIR vars, build-cursor-runner target, old runner test/lint/setup blocks, DEV_LDFLAGS, update-deps target, workflow-runner from build/local/clean targets

### Phase 2: CLI daemon bootstrap rewrite

- **Deleted**: `runner_native.go` (Python agent-runner bootstrap)
- **Rewrote**: `cursor_bootstrap.go` to bootstrap the unified runner at `backend/services/runner/` via `findRunnerDir()` (checks `STIGMER_RUNNER_DIR` env, repo-relative paths)
- **Updated**: `daemon.go` — removed `cursorrunner` import, simplified PID constants, removed backward-compat cursor-runner env var fallback
- **Updated**: `daemon_process.go` — cleaned stale comments, removed cursor-runner env vars
- **Updated**: `status_health.go` — renamed `GetWorkflowRunnerPID` to `GetRunnerPID`
- **Updated**: `BUILD.bazel` — removed runner_native.go source, agentrunner/cursorrunner deps
- **Updated**: All 5 platform embed files — replaced Docker/agent-runner comments with unified runner description

### Phase 3: Test harness migration

- **Deleted**: `test/integration/harness/agent_runner.go`, `cursor_runner.go`, `workflow_runner.go`
- **Updated**: `harness.go` — `TestHarness` struct replaced three runner fields with `UnifiedRunner *UnifiedRunnerStatic`; `Stop()` and `LogPaths()` updated
- **Updated**: `harness_config.go` — `RequireNativePrereqs` and `RequireCursorPrereqs` now check `th.UnifiedRunner`
- **Updated**: `suite_test.go` — three runner startup blocks replaced with single `StartUnifiedRunnerStatic(ctx, cfg, "agent_execution_runner", logger)` call

### Phase 4: Documentation and artifact cleanup

- **Deleted**: `docs/guides/runners/` (9 files)
- **Deleted**: `tools/codegen/schemas/agentic/runner/runner.json`
- **Deleted**: `mcp-server/gen/agentic/runner/runner_gen.go`
- **Updated**: `docs/guides/meta.json` — removed "runners" page reference

## Benefits

- ~322K lines of dead code removed from the repository
- Integration test suite starts one process instead of three (faster, simpler)
- CLI daemon bootstrap is clean — no imports of deleted packages
- New engineers see only the unified runner, no legacy confusion
- Build and lint targets no longer reference deleted services

## Impact

- **Integration tests**: All existing tests continue to work through the unified runner. The `RequireNativePrereqs` and `RequireCursorPrereqs` functions now gate on `UnifiedRunner != nil` instead of individual runner types.
- **CLI daemon**: The runner bootstrap now discovers `backend/services/runner/` directly instead of the deleted cursor-runner. The `STIGMER_RUNNER_DIR` env var provides an override.
- **Two test suites preserved**: `test/integration/` (global routing) and `test/integration-session-routing/` (session routing) remain as separate modules, both using the unified runner.

## Related Work

- [Desktop embedded runner execution target routing](2026-05-20-215359-desktop-embedded-runner-execution-target-routing.md) — Session 7 of the architecture simplification project
- Runner architecture simplification project — `_projects/2026-05/20260520.01.runner-architecture-simplification/`
- Unified runner migration project — `_projects/2026-05/20260518.01.unified-runner-migration/`
- Workflow runner TypeScript rewrite — `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/`

---

**Status**: Production Ready
**Timeline**: Session 14 of runner-architecture-simplification
