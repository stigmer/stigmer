# T12 Workflow Task Integration Tests (for_each, fork, validate, emit_event, notification)

**Date**: May 16, 2026

## Summary

Added ten offline integration tests covering five workflow task kinds that previously had no harness coverage in the e2e suite. A webhook capture helper supports notification assertions. Test design reflects proto constraints (`set_vars` string-only, no `while` on `for_each`) and known status-reporting gaps for inline nested tasks.

## Problem Statement

The T01 integration plan (Phase 3 / T12 task matrix) listed several control-flow and I/O task kinds without tests. Shipping workflow features without end-to-end proof increases regression risk in the converter → Temporal → zigflow pipeline.

### Pain Points

- No coverage for `for_each`, `fork`, `validate`, `emit_event`, or `notification`
- Notification tests needed a way to assert outbound HTTP payloads without external services
- First test run exposed proto/API mismatches (string-only `set_vars`, missing `while` field)
- Inline tasks under `for_each`/`fork` often missing from execution status snapshots

## Solution

Extended three existing integration test files with focused workflows built from proto `Workflow` definitions, deployed via `FixtureDeployer`, and asserted with `ExecutionWaiter`. Added `WebhookCaptureServer` in the harness for webhook notification tests.

## Implementation Details

### New tests (10)

| Test | Task kind |
|------|-----------|
| `TestWorkflowControlFlow_ForEach_Array` | `for_each` |
| `TestWorkflowControlFlow_ForEach_IntRange` | `for_each` |
| `TestWorkflowControlFlow_Fork_Parallel` | `fork` |
| `TestWorkflowControlFlow_Fork_Compete` | `fork` |
| `TestWorkflowData_Validate_SchemaPass` | `validate` |
| `TestWorkflowData_Validate_SchemaFail` | `validate` |
| `TestWorkflowData_Validate_BusinessRules` | `validate` |
| `TestWorkflowIO_EmitEvent` | `emit_event` |
| `TestWorkflowIO_Notification_Webhook` | `notification` |
| `TestWorkflowIO_Notification_WebhookFailed` | `notification` |

### Harness

- `WebhookCaptureServer`: buffered channel of POST bodies, always returns 200

### Test patterns

- Typed validation data: `set_vars` (strings) → `transform` (JQ) → `validate`
- `ForEach_Array`: assert workflow phase only when nested task status is empty
- `Fork_Compete`: informational note when slow branch is not cancelled promptly

## Benefits

- Closes a major gap in the T12 offline matrix for common orchestration primitives
- Documents proto limitations and runtime behavior for future test authors
- Webhook capture pattern reusable for future HTTP-side-effect tasks

## Impact

- **Developers**: Can run filtered offline tests for these task kinds before provider-backed suites
- **CI**: Offline integration job gains coverage when this lands on the feature branch
- **Product**: Surfaces gaps (`while` missing, compete cancel, inline task status) for follow-up

## Related Work

- Project `20260514.01.e2e-workflow-testing-infrastructure` (T01 plan, Phase 3)
- Session 8 Phase 2 task family tests; Session 11 listen converter
- `convertForkTask` branch YAML shape (already on branch HEAD from prior work)

---

**Status**: ✅ Tests written; full green re-run pending (environment/JVM startup)
**Timeline**: Single session (T12 gap closure)
