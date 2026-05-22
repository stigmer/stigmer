# Add Required-Field Validation for grpc_call and activity_call Tasks

**Date**: May 22, 2026

## Summary

Added missing required-field validation for `grpc_call` and `activity_call` task kinds to both the Go and Java in-process workflow validators. Workflows with empty task configs for these kinds are now correctly rejected at apply time, closing a gap where only `eval` and `http_call` were validated.

## Problem Statement

The `ValidateTaskConfigRequiredFields()` function in both the Go validator (`crossref.go`) and the Java validator (`InProcessWorkflowValidator.java`) only covered two task kinds: `eval` and `http_call`. All other task kinds -- including `grpc_call` and `activity_call` -- silently passed validation even with completely empty configs.

### Pain Points

- Workflows with `grpc_call` tasks missing required `service` and `method` fields were accepted, only to fail at runtime
- Workflows with `activity_call` tasks missing the required `activity` field were similarly accepted
- Two integration tests (`TestWorkflowGrpcCall_InvalidConfig`, `TestWorkflowActivityCall_InvalidConfig`) were failing because Apply did not reject invalid configs

## Solution

Added new `case` branches to the existing `switch` statement in `ValidateTaskConfigRequiredFields()` for both `grpc_call` and `activity_call` task kinds, following the exact same patterns established by the `eval` and `http_call` cases.

## Implementation Details

- **Go validator** (`crossref.go`): Added `grpc_call` case checking `service` and `method`, and `activity_call` case checking `activity`
- **Java validator** (`InProcessWorkflowValidator.java`): Added matching cases with identical field checks and error message strings to maintain Go/Java parity
- Field names were derived from the proto definitions (`GrpcCallTaskConfig` and `CallActivityTaskConfig`), not the fix document which incorrectly referenced `activity_name` instead of `activity`
- Error messages follow the established format: `task '<name>' (<kind>): required field '<field>' is missing or empty`
- No changes to the validation pipeline, orchestrator, or helper functions

## Benefits

- Invalid `grpc_call` and `activity_call` workflows are now caught at apply time rather than failing at runtime
- Consistent validation coverage across task kinds that have required proto fields
- Both integration tests now pass

## Impact

- **Validation layer**: Go and Java validators now cover 4 of 20+ task kinds for required-field checks
- **No breaking changes**: Only adds rejection of previously-invalid-but-accepted configs
- **Both services**: Changes applied to stigmer (Go) and stigmer-cloud (Java) repositories

---

**Status**: Production Ready
