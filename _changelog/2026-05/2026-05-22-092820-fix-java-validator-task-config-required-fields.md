# Fix: Java Validator Task Config Required Fields

**Date**: May 22, 2026

## Summary

Added task-config required field validation to the Java `InProcessWorkflowValidator` in stigmer-cloud, bringing it to parity with the Go `InProcessValidator` for eval and http_call task kinds. This fixes 2 integration tests that were failing because the Java service accepted invalid workflow specs.

## Problem Statement

The Go and Java validators both independently validate `WorkflowSpec` proto, but the Java validator was missing a validation step that the Go validator had — checking that task-type-specific required fields are present in the `task_config` Struct.

### Pain Points

- `TestValidateSpec_EvalTask_MissingModel` failed: submitting an `eval` task without the required `model` field returned `VALID` instead of `INVALID`
- `TestWorkflowError_InvalidConfig` failed: submitting an `http_call` task with a completely empty config was accepted at Apply time instead of being rejected
- The Go validator (`ValidateTaskConfigRequiredFields` in `crossref.go`) had been added as Step 2b in a prior session, but the Java validator was never updated to match

## Solution

Added `validateTaskConfigRequiredFields(WorkflowSpec)` to the Java `InProcessWorkflowValidator`, mirroring the Go reference implementation. The method validates:

- **eval** tasks: `model`, `subject`, `rubric` must be non-empty strings
- **http_call** tasks: `method` must be non-empty, `endpoint` must be a Struct containing non-empty `uri`

Error messages match the Go format exactly (`"task 'X' (eval): required field 'model' is missing or empty"`) to keep validation behavior consistent across services.

## Implementation Details

Single file changed in stigmer-cloud:

| File | Change |
|------|--------|
| `InProcessWorkflowValidator.java` | Add `validateTaskConfigRequiredFields()`, `getStringFieldValue()` helper, wire into `validate()` as Step 2b |

The new validation method works directly with the proto `Struct` field API (`Map<String, Value>`) rather than converting to `Map<String, Object>`, avoiding unnecessary serialization overhead.

Wiring point: between cross-reference validation (Step 2) and budget warnings (Step 3) in the `validate()` method — same position as in the Go validator.

## Impact

- **2 integration tests fixed**: `TestValidateSpec_EvalTask_MissingModel`, `TestWorkflowError_InvalidConfig`
- Both the `ValidateSpec` RPC and the `Apply`/`Create` pipeline are covered, since they share `InProcessWorkflowValidator.validate()` as the single validation entry point
- No changes to integration tests, Go validator, proto definitions, or any other handler

## Related Work

- Session 5 fixes: `_changelog/2026-05/2026-05-22-032331-integration-test-suite-session5-fixes.md` (added `ValidateTaskConfigRequiredFields` to Go validator)
- Session 4 triage: `_changelog/2026-05/2026-05-22-025000-integration-test-suite-session4-failure-report.md` (identified RC8 validation gap)

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes implementation + rebuild + test verification
