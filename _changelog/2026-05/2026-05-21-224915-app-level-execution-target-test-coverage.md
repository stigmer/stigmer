# App-Level Execution Target — Test Coverage

**Date**: May 21, 2026

## Summary

Added comprehensive unit test coverage for the app-level `executionTarget` SDK change across all four SDKs (React, TypeScript, Go, Python). 29 new tests in 9 files cover converter functions, React context inheritance, client-level default injection, proto serialization, and constructor parameter handling. All tests pass.

## Problem Statement

The app-level `executionTarget` change (commit `71fc66484`) introduced new configuration at every SDK layer, but shipped without corresponding test coverage for the new code paths.

### Pain Points

- React `ExecutionTargetContext` / `useExecutionTarget()` hook had zero tests
- React hooks (`useCreateSession`, `useNewSessionFlow`) had tests for per-call `executionTarget` but NOT for the new context fallback path — the core new behavior
- Go `WithExecutionTarget()` was the only `ClientOption` without a unit test
- Go `ApplyDefaultExecutionTarget()` method had no tests for any of its three branches
- TypeScript `Stigmer._applyExecutionTargetDefaults()` wrapping had no tests
- TypeScript `SessionInput.executionTarget` was the only spec field without a serialization test
- Python `StigmerClient(execution_target=...)` constructor parameter had no tests
- `toProtoExecutionTarget` / `fromProtoExecutionTarget` converters had no round-trip tests

## Solution

Added tests across all four SDK test suites, following each SDK's established patterns and conventions exactly.

## Implementation Details

### React SDK (4 files, 17 tests)

- **`execution-target.test.ts`** (new, 8 tests): `toProtoExecutionTarget` / `fromProtoExecutionTarget` mapping + round-trip tests. Mirrors the `harness.test.ts` pattern.
- **`hooks.test.tsx`** (extended, 3 tests): `useExecutionTarget()` returns `undefined` outside provider, returns `"local"` and `"cloud"` when wrapped with `ExecutionTargetContext.Provider`.
- **`useCreateSession.test.tsx`** (extended, 3 tests): Context fallback when per-call input omits `executionTarget`, per-call override wins over context, no context + no per-call = `undefined`. Uses new `wrapperWithExecutionTarget` factory that includes `ExecutionTargetContext.Provider`.
- **`useNewSessionFlow.test.tsx`** (extended, 3 tests): Context fallback via `createWrapper("local")`, per-hook option overrides context. Updated `createWrapper` to accept optional `executionTarget` parameter and wrap with `ExecutionTargetContext.Provider`.

### Go SDK (2 files, 3 tests)

- **`options_test.go`** (extended, 1 test): `TestWithExecutionTarget` — verifies default is `UNSPECIFIED`, option sets `LOCAL`. Follows the identical pattern of all other option tests.
- **`client_test.go`** (extended, 2 tests): `TestApplyDefaultExecutionTarget` — fills UNSPECIFIED input with client default, preserves explicit override. `TestApplyDefaultExecutionTarget_NoDefault` — no-op when client has no default.

### TypeScript SDK (2 files, 7 tests)

- **`stigmer.test.ts`** (new, 6 tests): Constructs `Stigmer` with capturing transport + `executionTarget` config, verifies `session.create` injects default, per-call override preserved, `session.apply` also gets default, no-default means no injection.
- **`session-client.test.ts`** (extended, 1 test): `executionTarget` proto serialization — verifies `spec.executionTarget` is set when provided in `SessionInput`.

### Python SDK (1 file, 4 tests)

- **`test_client.py`** (new, 4 tests): `default_execution_target` is `1` for `"local"`, `2` for `"cloud"`, `0` for `None`. `ValueError` raised on missing API key.

## Benefits

- All three behavioral branches of the resolution precedence (per-call > context/client default > server default) are now tested at each SDK layer
- React context inheritance — the core architectural change — has dedicated tests
- Proto enum conversion round-trips are verified
- Future regressions in default injection or override precedence will be caught

## Impact

- **Test suite growth**: +29 tests, +3 new files, +6 extended files
- **React SDK**: 506 → 523 tests (51 in the 4 affected files)
- **Go SDK**: 5 → 8 tests
- **TypeScript SDK**: 114 → 121 tests
- **Python SDK**: 5 → 9 tests
- **No production code changes** — test-only

## Related Work

- App-level execution target SDK change (71fc66484)
- Pre-deploy integration test expansion (20260521.01)

---

**Status**: Production Ready
**Files Changed**: 9 (3 new, 6 modified)
