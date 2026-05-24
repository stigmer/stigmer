# Session Notes: 2026-05-24 — Runner Data Accuracy Hardening

## Accomplishments

- Fixed 8 data accuracy bugs in the runner execution data pipeline
- Added 23 new unit tests covering previously untested paths
- Enhanced Go integration tests with cost/token assertions
- All 14 planned items completed (Batch 1: 5 accuracy fixes, Batch 2: 3 cost/token fixes, Batch 3: 6 test coverage items)

## Decisions Made

- **Agent token attribution**: Kept mapping `total_tokens` → `input_tokens` (output_tokens: 0) since the agent runtime only reports totals. Added `token_attribution: "total_only"` metadata for the frontend to avoid misleading display.
- **LLM structured output**: Used LangChain's `{ includeRaw: true }` option on `withStructuredOutput()` to access `usage_metadata` from the raw AIMessage — cleanest approach, no streaming fallback needed.
- **Cost fallback**: Changed `computeLlmCostMicros` to use `getModelPricing()` (DEFAULT_PRICING fallback) rather than returning 0 for unknown models. Estimated cost is better than silent zero.
- **retryContext design**: Added `RetryContextInfo` with `maxAttempts` to `TaskExecutionContext`. Set by `try.ts` before executing the try block. Supports Infinity when only duration-limited (no attempt count).
- **willRetry semantics**: `willRetry: true` is optimistic (based on configuration intent, not guaranteed). This matches AWS Step Functions and Temporal conventions.

## Key Code Changes

- `task-status-accumulator.ts`: Added `getAttempt()` public method, `durationMs` param on `taskFailed()`
- `types.ts`: Added `RetryContextInfo` interface and `retryContext` field on `TaskExecutionContext`
- `do-executor.ts`: Replaced hardcoded attemptNumber/willRetry with accumulator-tracked values, pass durationMs to taskFailed, added token_attribution metadata for agent tasks
- `try.ts`: Creates modified ctx with retryContext when catch.retry is configured
- `call-llm.ts`: Structured output path now uses `includeRaw: true` for token capture
- `model-pricing.ts`: `computeLlmCostMicros` uses `getModelPricing()` fallback
- `workflow-event-activities.ts`: Added `call:function:cursor` to TASK_KIND_MAP

## Deferred Items (Not in Scope)

These remain as follow-up work items from `checkpoints/runner-task-io-followups.md`:
- Agent HITL live status propagation (needs Temporal signal handler changes)
- Budget enforcement wiring (has UX implications)
- Resolved config capture (needs builder return-type changes)
- Artifact reference model (needs S3-like infrastructure)
- `pending_approvals` race condition (needs proto change)

## Next Session Plan

- T13: Execution History and Operations Dashboard (frontend)
- Or: Tackle medium-priority backend follow-ups (agent HITL status, budget enforcement) as a separate planning cycle
