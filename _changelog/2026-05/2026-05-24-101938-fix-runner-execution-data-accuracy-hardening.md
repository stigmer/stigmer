# Runner Execution Data Accuracy Hardening

**Date**: May 24, 2026

## Summary

Fixed 8 data accuracy bugs in the workflow runner's execution data pipeline — attempt tracking, willRetry signaling, failed task duration, token attribution, cost computation, and proto kind mapping — ensuring the T01-T12 frontend components (inspector, waterfall, overview) display correct execution data. Added 23 new unit tests and enhanced integration tests with cost/token assertions.

## Problem Statement

The task I/O, cost/token, and event enrichment pipeline built during the T05/T07 sprints had several data accuracy defects that directly corrupted frontend displays:

### Pain Points

- Retry attempt numbers were always `1` — the waterfall timeline couldn't distinguish retry sequences
- `willRetry` was always `false` — the inspector showed failed tasks as terminal when they were about to retry
- Failed tasks had no `durationMs` — waterfall bars had no end point for failed tasks
- Agent calls mapped all tokens to `input_tokens` with `output_tokens: 0` — misleading token breakdown in the inspector
- LLM structured output calls reported 0 tokens and $0.00 cost — completely broken for a major use case
- Unknown models silently produced zero cost instead of using the default pricing fallback
- `call:function:cursor` events fell back to kind 0 (unspecified) in the proto

## Solution

Targeted fixes across the runner's TypeScript pipeline (accumulator, do-executor, try/catch, call-llm, call-agent, model-pricing, event activities) with no proto or server-side changes required. All fixes are backward-compatible — the existing proto contract already supports the corrected data.

## Implementation Details

### Batch 1: Data Accuracy Fixes

- **Attempt number propagation**: Exposed `getAttempt()` on `TaskStatusAccumulator`; replaced hardcoded `attemptNumber: 1` in `do-executor.ts` with accumulator-tracked values
- **willRetry signaling**: Added `RetryContextInfo` interface + `retryContext` on `TaskExecutionContext`; `try.ts` sets it when retry is configured; `do-executor.ts` reads it to compute `willRetry` on `task_failed` events
- **Failed task duration**: Added optional `durationMs` parameter to `taskFailed()` in the accumulator; `do-executor.ts` now computes and passes `Date.now() - taskStartMs`
- **Cursor kind mapping**: Added `"call:function:cursor": WorkflowTaskKind.agent_call` to `TASK_KIND_MAP` in `workflow-event-activities.ts`

### Batch 2: Cost and Token Accounting

- **Agent token attribution**: Added `token_attribution: "total_only"` metadata on agent tasks so the frontend can avoid displaying a misleading input/output split
- **LLM structured output tokens**: Changed `withStructuredOutput()` to use `{ includeRaw: true }`, extracting `usage_metadata` from the raw AIMessage — structured output calls now report real tokens and cost
- **Cost fallback**: Changed `computeLlmCostMicros` to use `getModelPricing()` (which falls back to `DEFAULT_PRICING`) instead of direct map lookup — unknown models now get an estimated cost rather than silent $0.00

### Batch 3: Test Coverage (23 new tests)

- `task-status-accumulator.test.ts`: 10 new tests (waitingApproval, taskSkipped, structuredError metadata, durationMs on failure, getAttempt)
- `workflow-event-activities.test.ts`: 1 new test (cursor kind mapping)
- `model-pricing.test.ts`: 4 new tests (resolveModelId, getModelPricing fallback, updated expectations)
- `call-agent.test.ts`: 4 new tests (enrichResultWithCost effects, ON_INVALID_FAIL, ON_INVALID_FALLBACK)
- `try.test.ts`: 4 new tests (retry.when/exceptWhen conditionals, attempt limit exhaustion, retryContext propagation)
- `workflow_llm_call_test.go`: Enhanced with `AssertTaskHasInput`, `AssertTaskTokens`, `total_cost_micros > 0` assertions

## Benefits

- Inspector panel shows correct attempt numbers during retry sequences
- Waterfall timeline renders proper bar widths for failed tasks
- Agent tasks display token totals without misleading input/output split
- LLM structured output calls show real cost and token consumption
- All task types map to correct proto WorkflowTaskKind values
- Unknown models get estimated cost from default pricing (not silent $0.00)

## Impact

- **Frontend**: Every execution inspector tab, waterfall bar, and cost chip that reads task status data now receives accurate values
- **Runner**: 14 files changed, 630 insertions, 27 deletions
- **Tests**: 1810 total runner unit tests, 1783 passing, 0 regressions from these changes

## Related Work

- T05 Runtime Inspector Panel — the primary consumer of task I/O data
- T07 Waterfall Timeline — depends on accurate durationMs and attempt tracking
- Runner Task Status Enrichment — the earlier sprint that built the pipeline being hardened here
- Checkpoint: `_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/runner-task-io-followups.md`

---

**Status**: Production Ready
**Timeline**: Single session
