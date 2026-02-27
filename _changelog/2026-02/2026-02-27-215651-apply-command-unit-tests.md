# Unit Tests for Apply Command (Phase 5)

**Date**: February 27, 2026

## Summary

Added 68 unit tests across 6 new test files for the `stigmer apply` command in `cmd/stigmer/root/`. This fills a critical coverage gap — five production files with ~980 lines of apply logic (directory scanning, resource detection, org resolution, result builders) previously had zero test coverage. All tests pass alongside the existing 228 tests in the package.

## Problem Statement

Phases 3 and 4 of the Project Declarative Track introduced substantial new code for the apply command's declarative and SDK tracks, but shipped without tests. The command layer in `cmd/stigmer/root/` had no apply-related tests, while the internal packages (`project/`, `apply/`) were well-covered.

### Pain Points

- Zero test coverage for pure functions: `scanResourceFiles`, `detectResourceItems`, `resolveApplyOrganization`, `buildResourceReference`, `countMembersByKind`, all result builders
- No regression safety net for the org resolution priority chain (flag > yaml > cloud config > local default)
- No tests verifying declarative-mode directory scanning correctly excludes `stigmer.yaml` and skips subdirectories
- No tests for the SDK dry-run and result rendering paths

## Solution

Focused on testing all **pure functions** and **filesystem-only functions** — the code that takes inputs and returns outputs without needing a running backend. Organized as one test file per production file, following the existing convention in the codebase.

## Implementation Details

### New Files

| File | Tests | Coverage |
|---|---|---|
| `apply_test_helpers_test.go` | — | Shared builders: `newTestProject`, `newTestMembers`, `writeResourceYAML`, etc. |
| `apply_file_handlers_test.go` | 22 | `buildResourceReference`, `truncateForDisplay`, 6 per-resource result builders |
| `apply_declarative_test.go` | 30 | `scanResourceFiles`, `detectResourceItems`, `countMembersByKind`, declarative result builders |
| `apply_org_test.go` | 12 | `resolveApplyOrganization` priority chain, `buildAtomicTrackResult` |
| `apply_file_test.go` | 12 | `resolveApplyFiles`, `detectApplyItems` |
| `apply_project_result_test.go` | 12 | `buildSDKResult`, `executeSDKDryRun` |

### Testing Patterns Introduced

- **`requireSectionField` / `findSectionField`** — Assertion helpers that inspect `CommandResult` sections by title and key, avoiding brittle string matching on rendered output
- **`writeResourceYAML`** — Creates minimal valid Stigmer YAML resource files in temp dirs for filesystem tests
- **Shared proto builders** — Reusable constructors for Project, ApplyResult, and per-resource-type results to avoid duplication

### What Was Not Tested (and Why)

The orchestration functions (`executeDeclarativeApply`, `executeProjectApply`, `executeFileApply`) hard-code calls to `config.Load()`, `backend.NewConnection()`, and `daemon.EnsureRunning()`. Testing them at the unit level requires dependency injection refactoring — a separate, deliberate effort.

## Benefits

- **Regression safety** for the org resolution priority chain, directory scanning logic, and result rendering
- **68 new tests** covering the previously untested apply command layer
- **Clean test patterns** with shared helpers that future test authors can reuse
- **Confidence** for the upcoming PR review — reviewers can verify behavior through tests rather than code reading alone

## Impact

- `cmd/stigmer/root/` package: 296 total tests (up from 228)
- All existing tests in `apply/` and `project/` packages continue to pass
- BUILD.bazel updated with 6 new test srcs and 8 new deps

## Related Work

- Phase 3: CLI declarative track implementation (`2523ba93`)
- Phase 4: SDK track adaptation (`b5c48b55`)
- T01 task plan: `_projects/2026-02/20260227.01.project-declarative-track/tasks/T01_0_plan.md`

---

**Status**: Production Ready
**Timeline**: 1 session (~45 minutes)
