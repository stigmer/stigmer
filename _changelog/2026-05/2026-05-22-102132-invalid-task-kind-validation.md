# Invalid Task Kind Validation

**Date**: May 22, 2026

## Summary

Added explicit task kind validation to the workflow validation pipeline in both the Java service (stigmer-cloud) and the Go validator (stigmer). Workflows with unknown or unspecified task kinds (e.g., unrecognized enum values like `999`, or the default unspecified value `0`) are now rejected with a clear error message before YAML conversion is attempted.

## Problem Statement

The `ValidateSpec` RPC returned `VALID` for workflows containing tasks with completely invalid/unknown `Kind` values. The `TestValidateSpec_InvalidTaskKind` integration test was failing because no layer of validation caught unrecognized enum values.

### Pain Points

- Java `convertTaskByKind` silently converted `UNRECOGNIZED` kinds to generic `{call: "UNRECOGNIZED", with: config}` YAML — producing "valid" output without any error
- Both `validateCrossReferences` and `validateTaskConfigRequiredFields` skipped unknown kinds in their switch statements
- Users could submit fundamentally malformed workflows and receive a VALID response

## Solution

Introduced a new "Step 0: Task kind validation" that runs before YAML conversion in both validators. This step checks each task's `Kind` against the set of known enum values and short-circuits with `INVALID` if any task has an unrecognized or unspecified kind. This is a fail-fast approach — there is no value in attempting YAML conversion or downstream validation for a workflow with invalid task kinds.

## Implementation Details

### Java (stigmer-cloud)

Added `validateTaskKinds(WorkflowSpec)` to `InProcessWorkflowValidator.java` that rejects `WorkflowTaskKind.UNRECOGNIZED` and `WorkflowTaskKind.workflow_task_kind_unspecified`. Wired as Step 0 before YAML conversion with short-circuit return.

### Go (stigmer)

Added `ValidateTaskKinds(spec)` to `crossref.go` that checks each task's kind against the generated `WorkflowTaskKind_name` map. Wired into `validator.go` as Step 0 before YAML conversion, producing a clearer error message than the converter's generic "Failed to generate YAML" error.

## Benefits

- Clear, user-facing error message: `task 'badTask': unknown or unspecified task kind (value=999)`
- Fail-fast: no wasted time on YAML conversion or downstream validation for invalid input
- Defense in depth: validated in both Java (production path) and Go (standalone/unit-test path)
- Consistent error format across both services

## Impact

- Fixes `TestValidateSpec_InvalidTaskKind` integration test
- Protects against clients sending unrecognized proto enum values (future-proofing for proto evolution)
- Guards against accidentally defaulted `Kind` fields (value 0) that would otherwise silently pass through

## Related Work

- Part of the integration test failure triage from session 4 failure report
- Complements the grpc_call/activity_call required-field validation added in the same session

---

**Status**: Production Ready
