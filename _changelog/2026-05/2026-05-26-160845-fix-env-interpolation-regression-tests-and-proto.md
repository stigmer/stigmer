# Fix Env Interpolation Regression: Integration Tests, Proto Fix, and Root Cause

**Date**: May 26, 2026

## Summary

Added 4 regression integration tests for optional env var interpolation in workflow agent_call messages, removed the `min_len=1` constraint from `ExecutionValue.value` proto to allow empty env values, and identified the root cause of the intermittent `${ $env.NOTIFICATION_DATE }` pass-through: stale runner `dist/` builds when the desktop app restarts without triggering `make build-runner`.

## Problem Statement

The `daily-notification-plan` workflow's `${ $env.NOTIFICATION_DATE }` expression was intermittently passing through as literal text to child agent executions instead of resolving to an empty string. MongoDB forensics across 19 production agent executions revealed the issue was not a code regression — the Phase 2 embedded expression interpolation (commit `14acbd3f5`, May 23) is correct and present in the source. The intermittent failures correlated with desktop runner restarts where `dist/` contained a pre-fix build.

### Pain Points

- `NOTIFICATION_DATE` is declared `optional: true` but when omitted, the literal `${ $env.NOTIFICATION_DATE }` appeared in the agent's message instead of resolving to empty string
- The `ExecutionValue.value` proto field had a `min_len=1` constraint that prevented empty strings through the API, which is incompatible with optional env vars
- No integration tests specifically covered the production pattern of multi-line agent_call messages with missing optional env vars
- The intermittent nature (works → fails → works on the same day) made the bug difficult to diagnose

## Solution

### 1. Regression Integration Tests

Created `test/integration/workflow_env_interpolation_regression_test.go` with 4 test cases:

| Test | Scenario | Assert |
|------|----------|--------|
| `OptionalVarMissing_ResolvesToEmpty` | Optional env var not provided (production case) | `Date: \n` — empty value, no raw `${ $env.` |
| `OptionalVarProvided_ResolvesToValue` | Optional env var provided with value | `Date: 2026-05-26` — value substituted |
| `MultiLineMultipleEnvRefs` | Mix of provided + missing in multi-line message | All provided substituted, all missing → empty |
| `RequiredVarProvided_ResolvesCorrectly` | Required env vars (including secret) provided | Both values correctly interpolated |

All 4 tests pass in the integration harness (107.6s total, 3.4s per test).

### 2. Proto Constraint Removal

Removed `(buf.validate.field).string.min_len = 1` from `ExecutionValue.value` in `apis/ai/stigmer/agentic/executioncontext/v1/spec.proto`. Empty strings are now valid env values, which aligns with optional workflow env var semantics.

Stubs regenerated in both `stigmer` (`make protos`) and `stigmer-cloud` (`make protos`).

### 3. Root Cause: Stale Desktop Runner Build

MongoDB timeline analysis of all 19 `notification-analyst` agent executions:

| Period | Status | Explanation |
|--------|--------|-------------|
| May 22-23 | OLD_UNRESOLVED (8x) | `${ $context.env.* }` — wrong namespace, pre-fix |
| May 24 AM | NEW_UNRESOLVED (3x) | `${ $env.* }` — namespace fixed, but runner not rebuilt |
| May 24 PM | RESOLVED (2x) | Fix deployed via `make build-runner` |
| May 25 | NEW_UNRESOLVED (3x) | Runner restarted without rebuild |
| May 26 AM | RESOLVED (2x) | Runner rebuilt |
| May 26 8AM | NEW_UNRESOLVED (1x) | Runner restarted without rebuild |

The `make desktop-dev` target correctly runs `make build-runner` before starting Tauri. But if the Tauri app is restarted directly (crash, manual restart via `npm run tauri dev`), it spawns `node resources/runner/dist/main.js` using the symlinked `dist/` — which may be stale.

No cloud runner was involved: the `stigmer-prod` K8s namespace has no `workflow-runner` pod. The old `workflow-runner-5f7896657c-sc6zf` pod (visible in May 22 errors) was decommissioned.

## Implementation Details

### Files Created

| File | Purpose |
|------|---------|
| `test/integration/workflow_env_interpolation_regression_test.go` | 4 regression tests + 2 shared helpers |

### Files Modified

| File | Change |
|------|--------|
| `apis/ai/stigmer/agentic/executioncontext/v1/spec.proto` | Removed `min_len=1` from `ExecutionValue.value` |
| `apis/stubs/go/...` | Regenerated Go stubs |
| `apis/stubs/ts/...` | Regenerated TypeScript stubs |
| `apis/stubs/java/...` | Regenerated Java stubs |
| `apis/stubs/python/...` | Regenerated Python stubs |

### Shared Test Helpers

- `createEnvInterpolationAgent` — creates a minimal test agent scoped to the test
- `buildEnvInterpolationWorkflow` — parameterized workflow builder with env declarations and task config

## Benefits

- **Regression safety**: 4 integration tests lock down the env interpolation behavior that was previously untested for the specific production pattern
- **Proto alignment**: `ExecutionValue.value` now correctly allows empty strings for optional env vars
- **Root cause documented**: Future intermittent failures can be traced to stale `dist/` builds, with a clear fix (run `make build-runner` before restarting the desktop app)

## Impact

- **Integration tests**: 4 new tests in `test/integration/` (additive, no existing tests modified)
- **Proto**: `ExecutionValue.value` API contract change — empty strings now accepted (non-breaking: relaxes validation)
- **Desktop dev workflow**: Root cause identified for the intermittent expression pass-through

## Related Work

- `2026-05-23-171953-feat-workflow-embedded-expression-interpolation.md` — Phase 2 embedded interpolation (the fix that was intermittently missing)
- `2026-05-23-141124-*.md` — Namespace fix ($context.env → $env)
- `2026-05-26-135639-fix-desktop-runner-proxy-token-staleness.md` — Prior desktop runner fix (token staleness)
- `test/integration/workflow_expression_interpolation_test.go` — Existing expression interpolation test (covers basic case)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours including MongoDB forensics)
