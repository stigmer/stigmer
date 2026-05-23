# Runner Backend Enrichment: Agent Call Events, Task Retrying, task_id, LLM Cost

**Date**: May 23, 2026

## Summary

Implemented four backend follow-up items from the Runner I/O and Waterfall enrichment backlogs: agent call event emission, task retrying events, deterministic task_id generation, and LLM cost attribution. These changes unlock waterfall timeline sub-spans, retry gap visualization, per-task identity, and real cost data for LLM tasks — all with zero frontend or server changes.

## Problem Statement

After the T05 Runtime Inspector and T07 Waterfall Timeline frontend work, the runner backend had several data gaps that left frontend features in graceful-degradation mode:

### Pain Points

- Agent call tasks showed as opaque solid bars in the waterfall — no visibility into when the child agent started/completed
- Retry attempts had no intermediate events — the waterfall couldn't distinguish backoff gaps from execution time
- `WorkflowTask.task_id` was always empty — no way to correlate retry attempts or link events to specific task instances
- `call:llm` tasks showed `$0.00` cost in the inspector despite reporting token counts

## Solution

Four targeted changes to the runner, each independently testable and deployable, requiring no proto changes, no server (Go/Java) changes, and no frontend changes.

## Implementation Details

### P1: Agent Call Event Emission

- Extracted `executeAgentCall()` private method on `CallAgentTaskBuilder` that brackets each `ctx.callAgent()` call with `agent_call_started` and `agent_call_completed` event descriptors
- `agent_call_started`: emitted before dispatch with `agentSlug`, truncated `messageSummary` (200 chars)
- `agent_call_completed`: emitted after completion with `childExecutionId`, `tokensConsumed`, `costMicros`, or `error` on failure
- Events emitted for each attempt in the output-validation retry loop
- **Files**: `workflow-engine/tasks/call-agent.ts`
- **Tests**: 6 new tests covering success, failure, no-emitEvents, truncation, retry loop, missing usage_summary

### P2: Task Retrying Event Emission

- Added `TaskRetryingEvent` descriptor type to `types.ts` with `failedAttempt`, `nextAttempt`, `delayMs`
- Added `task_retrying` → `TaskRetryingPayloadSchema` mapping in `toProtoEvent()` (workflow-event-activities.ts)
- Emit `task_retrying` from the retry loop in `try.ts`, after computing delay and before sleeping
- **Files**: `types.ts`, `workflow-event-activities.ts`, `tasks/try.ts`
- **Tests**: 4 new tests (2 proto mapping, 2 emission in retry loop)

### P3: task_id Generation

- Added `taskId: string` field to `TaskStatusEntry` interface
- Added per-task attempt counting via `attemptCounts` Map in `TaskStatusAccumulator`
- Format: `{taskName}:{attemptNumber}` (deterministic, human-readable, sandbox-safe)
- Wired `ts.taskId` to `WorkflowTask.task_id` in proto construction
- **Files**: `task-status-accumulator.ts`, `workflow-event-activities.ts`
- **Tests**: 7 new tests covering first attempt, retries, preservation through lifecycle, uniqueness, skipped tasks

### P4: LLM Cost Attribution

- Created `shared/model-pricing.ts` — static pricing table for 14 model variants (Anthropic claude-sonnet-4/haiku-4.5/opus-4, OpenAI gpt-4o/gpt-4o-mini/o3-mini/gpt-4-turbo)
- `computeLlmCostMicros(modelId, inputTokens, outputTokens)` computes micro-USD cost; returns 0 for unknown models
- Wired into `call-llm.ts`: after each LLM call, injects `__stigmer_cost_micros` into the result object
- Existing `extractCostFromOutput` in do-executor picks it up automatically
- **Files**: `shared/model-pricing.ts` (new), `activities/call-llm.ts`
- **Tests**: 11 new tests (cost computation, rounding, unknown models, large token counts, known model IDs)

## Benefits

- **Waterfall timeline**: Agent call tasks now show nested purple sub-span bars showing child agent duration
- **Retry visualization**: Visible backoff gaps between retry attempts (matching AWS Step Functions red/gray pattern)
- **Data model completeness**: Every task in every execution now has a unique, deterministic `task_id`
- **Cost accuracy**: LLM tasks report real cost data instead of `$0.00`
- **Zero deployment risk**: No proto, server, or frontend changes required

## Impact

- **Runner (TypeScript)**: 11 files changed, 1 new file, 28 new tests
- **Test suite**: 592 tests passing across 29 workflow-engine test files, zero regressions
- **Frontend**: All existing waterfall, inspector, and execution graph consumers automatically benefit
- **Servers (Go/Java)**: No changes — full-replace task merge logic propagates richer data automatically

## Related Work

- T05: Runtime Inspector Panel — built the Input/Output/Cost tabs that now show real data
- T07: Execution Waterfall Timeline — built the sub-span and retry gap rendering that these events drive
- Runner Task Status Enrichment — the earlier session that populated the core I/O fields
- `checkpoints/runner-task-io-followups.md` — 8 deferred items, 3 addressed in this session
- `checkpoints/t07-waterfall-backend-followups.md` — 5 deferred items, 2 addressed in this session

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour implementation
