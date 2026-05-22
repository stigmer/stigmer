# Integration Test Suite — Session 7: Java Converter & Data Piping Fixes

**Date**: May 22, 2026

## Summary

Fixed the primary root cause of 23 integration test failures: the Java `InProcessWorkflowValidator` in stigmer-cloud was producing malformed CNCF Serverless Workflow YAML for nested task structures (for_each, fork, try_catch, wait, raise). Additionally fixed a stale runner dist issue and a task-input piping bug that caused transform/validate tasks to receive null input.

## Problem Statement

After Session 5 & 6 fixes (which addressed 51 tests), a fresh full-suite run revealed 36 new failures. Investigation showed the root cause was different from previous sessions — the Java service's validator (not the Go validator) generates the YAML stored in workflow status, and its conversion logic was severely incomplete.

### Pain Points

- Java `convertForTask` only extracted `in` and `each`, completely ignoring the nested `do` tasks
- Java `convertForkTask` passed raw `{name, do}` branch maps without converting to CNCF single-key format
- Java `convertTryTask` passed raw nested tasks without recursive conversion
- Java `convertWaitTask` didn't unwrap the `duration` oneof, producing `{duration: {seconds: 10}}` instead of `{seconds: 10}`
- Java `convertRaiseTask` used raw error type strings instead of CNCF error URIs
- Runner `dist/` was stale (built before Session 5), so `ApplicationFailure.nonRetryable` wrapping was missing
- `resolveTaskInput` returned workflow input instead of previous task's exported output for subsequent tasks
- Validate tests used `$data.buildUser` but exports store in `$context`

## Solution

Three targeted fixes across both repositories:

## Implementation Details

### Fix 1: Java InProcessWorkflowValidator (stigmer-cloud)

Complete rewrite of nested task conversion in `InProcessWorkflowValidator.java`:
- Added `convertNestedTaskList()` — recursively converts raw proto-Struct task entries to CNCF format
- Added `convertNestedTaskByKind()` — dispatches nested tasks to appropriate converters
- Fixed `convertForTask()` — now extracts and recursively converts the `do` block
- Fixed `convertForkTask()` — converts branches from `[{name, do}]` to `[{branchName: {do: [...]}}]`
- Fixed `convertTryTask()` — recursively converts `try` and `catch.do` task lists
- Fixed `convertWaitTask()` — unwraps `duration` oneof to produce `{seconds: N}`
- Fixed `convertRaiseTask()` — maps error types to CNCF URIs with proper status codes

### Fix 2: Runner Dist Rebuild + Task Input Piping (stigmer)

- Rebuilt runner dist to include Session 5's `ApplicationFailure.nonRetryable` wrapping
- Fixed `resolveTaskInput` in `do-executor.ts` — uses `state.output` (previous task's export) instead of original workflow input
- Fixed `CallFunctionTaskBuilder` — injects task input as `config.input` for transform/validate when not explicitly set

### Fix 3: Test Expression Corrections (stigmer)

- `workflow_data_test.go`: Changed `${ $data.buildUser }` → `${ $context.buildUser }` and `${ $data.buildOrder }` → `${ $context.buildOrder }` (exports store in context, not data)

## Files Changed

### stigmer-cloud

| File | Change |
|------|--------|
| `backend/.../workflow/lib/InProcessWorkflowValidator.java` | Complete nested task conversion rewrite |

### stigmer

| File | Change |
|------|--------|
| `backend/services/runner/src/workflow-engine/do-executor.ts` | Fix `resolveTaskInput` to use `state.output` |
| `backend/services/runner/src/workflow-engine/tasks/call-function.ts` | Inject task input for transform/validate |
| `backend/services/runner/src/activities/call-function.ts` | Pass `resolved.input` to transform activity |
| `test/integration/workflow_data_test.go` | Fix `$data` → `$context` references |

## Impact

- **23 of 36 tests fixed** — all converter-related and data-piping failures resolved
- **13 remaining tests** documented in 4 separate issue files (`_cursor/fix-*.md`) for parallel investigation:
  - 7 lifecycle phase transition tests
  - 3 FGA visibility tests
  - 2 validation spec gap tests
  - 1 HITL outcome routing test
- Test execution time dramatically reduced — validate tests went from 17.9s (5 retries) to 0.5s

## Related Work

- Session 5: `_changelog/2026-05/2026-05-22-032331-integration-test-suite-session5-fixes.md`
- Session 6: `_changelog/2026-05/2026-05-22-081140-integration-test-suite-session6-rc7a-fix.md`

---

**Status**: 🔄 23/36 Tests Fixed — 13 remaining across 4 categories (parallel investigation)
**Timeline**: ~45 minutes for diagnosis + implementation
