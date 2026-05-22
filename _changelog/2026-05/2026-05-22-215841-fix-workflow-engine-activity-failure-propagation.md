# Fix Workflow Engine Activity Failure Propagation

**Date**: May 22, 2026

## Summary

Fixed a critical error propagation bug in the CNCF Serverless Workflow engine that caused all workflow execution activities to fail with an opaque "Activity task failed" message instead of the actual error. This unblocked the offline deterministic test suite (3 eval tests now pass).

## Problem Statement

The offline integration tests (`TestOffline_Eval_PassFail`, `TestOffline_Eval_NumericScore`, `TestOffline_Eval_WarnPolicy`) consistently failed with `EXECUTION_FAILED` instead of `EXECUTION_COMPLETED`. The Java service logged `"Activity task failed"` with type `WORKFLOW_EXECUTION_FAILED` — a completely generic message that provided no diagnostic information about the actual failure.

### Pain Points

- Offline eval tests were the sole blocker preventing Suite 5 from passing
- The generic error message made root cause diagnosis extremely difficult
- The error wrapping discarded non-retryable semantics from the original failure, causing Temporal to misclassify the failure type
- The documented root cause ("ExecutionContext not found race") was a red herring — the runner handled that case gracefully

## Solution

The root cause was in `engine-core.ts`'s top-level catch block. When a Temporal activity throws a non-retryable `ApplicationFailure`, the Temporal SDK delivers it to the workflow as an `ActivityFailure` wrapper. The catch block only checked for `CancelledFailure` and `ApplicationFailure` (both extend `TemporalFailure`), but `ActivityFailure` is a distinct sibling class. It fell through to a generic wrapper that extracted only `err.message` (the generic "Activity task failed" string) — losing both the actual error details and the non-retryable semantics.

## Implementation Details

**`backend/services/runner/src/workflows/engine-core.ts`**:
- Added `ActivityFailure` import from `@temporalio/workflow`
- Added explicit handling: when the caught error is an `ActivityFailure` whose `.cause` is an `ApplicationFailure`, re-throw the cause directly (preserving the original type, message, and non-retryable flag)
- Added `extractErrorMessage()` helper that traverses the `ActivityFailure` → `ApplicationFailure` chain to find meaningful error messages for workflow event emission

**`backend/services/runner/tsconfig.build.json`**:
- Excluded `src/__test-utils__` from the production build (pre-existing type errors in untracked test utility files were blocking compilation)

## Benefits

- All 3 offline eval tests now pass (PassFail, NumericScore, WarnPolicy)
- Activity failures now propagate with their full error type, message, and non-retryable classification
- Workflow execution failure events contain actionable error messages instead of opaque "Activity task failed"
- Future activity failures will be immediately diagnosable from logs without requiring runner-side debugging

## Impact

- **Offline integration suite**: Unblocked — eval workflow tests pass
- **Error observability**: All workflow task activity failures now surface their root cause to the parent orchestrator and to execution status events
- **No behavioral change for success paths**: Only the error path is affected

## Related Work

- Integration test fixes tracking: `_cursor/integration-test-fixes-2026-05-22.md`
- Provider test failures (Category 8 — workflow execution failures): `_cursor/provider-test-failures-2026-05-22.md`
- HITL offline tests remain blocked on a separate `ConnectMcpServer` timeout issue (not addressed here)

---

**Status**: ✅ Production Ready
**Timeline**: Investigation + fix in single session (~30 min active)
