# Cursor-Runner Validation Fixes: Enum Normalization + tsx Runtime

**Date**: May 15, 2026

## Summary

Fixed two bugs that prevented cursor-runner integration tests from passing: a harness enum validation mismatch in the workflow validation pipeline, and a Node.js TypeScript import failure in the cursor-runner startup. All 6 provider-backed tests now pass end-to-end, including the 2 new cursor call tests.

## Problem Statement

The cursor-runner integration tests (added in Session 14) could never actually run because of two independent startup failures that blocked the full cursor pipeline.

### Pain Points

- `TestWorkflowCursorCall_FileCanary` and `TestWorkflowCursorCall_StructuredOutput` failed immediately with `invalid value for enum field harness: "cursor"` — the Java service's workflow validation rejected the friendly enum shorthand
- Even after fixing validation, the cursor-runner process crashed on startup with `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".ts"` — Node.js couldn't import the proto stubs
- The cursor test timeout (5 minutes) caused the Java service to crash, cascading failures to all subsequent provider tests

## Solution

**Bug 1**: Added `normalizeEnumShorthands()` to the validation path (`UnmarshalTaskConfig`) that translates user-friendly enum values (`"cursor"`, `"native"`) to canonical proto names (`"HARNESS_CURSOR"`, `"HARNESS_NATIVE"`) before `protojson.Unmarshal`. This mirrors the existing normalization in the execution path (`task_builder_call_agent.go:parseConfig()`).

**Bug 2**: Switched the cursor-runner harness from `node dist/main.js` to `tsx src/main.ts`. The `@stigmer/protos` package exports raw `.ts` files in dev mode, which `tsx` handles natively but Node.js cannot.

## Implementation Details

### Enum Normalization (`unmarshal.go`)

The `normalizeEnumShorthands` function intercepts JSON bytes before protojson deserialization, scoped to `agent_call` tasks only. It parses the JSON map, checks for a `harness` field with a known shorthand, rewrites it to the full proto enum name, and re-serializes.

### Cursor-Runner Harness (`cursor_runner.go`)

Replaced the `node` + `dist/main.js` + `ensureCursorRunnerBuilt` pattern with a simpler `tsx` + `src/main.ts` approach. Removed 39 lines of build infrastructure code. Also removed the `build-cursor-runner` prerequisite from the Makefile's `test-integration-providers` target.

## Benefits

- All 6 provider-backed tests pass: agent_call (2), cursor_call (2), llm_call (2)
- Cursor-runner tests exercise the complete pipeline: workflow-runner → Session(harness=CURSOR) → AgentExecution → Java → Temporal → cursor-runner
- Zero-friction developer experience: `make test-integration-providers` handles everything automatically
- Net code reduction: 55 insertions, 54 deletions (removed build boilerplate, added focused normalization)

## Impact

- **Integration tests**: Full cursor pipeline validated end-to-end for the first time
- **Developer experience**: Enum shorthands (`cursor`, `native`) now work in both validation and execution paths
- **CI readiness**: Provider suite is fully green and can be wired into the provider CI workflow

---

**Status**: ✅ Production Ready
