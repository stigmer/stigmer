# Session Notes: 2026-05-20, Session 10

## Phase 5.1b: Catch-Level Retry

### Accomplishments

- Implemented CNCF Serverless Workflow catch-level retry — a net-new feature that Go never built
- Created `computeRetryDelay()` pure function with three backoff strategies (constant, exponential, linear), jitter, and dual limit mechanisms (attempt count + total duration)
- Added retry loop to `executeTryTask()` with `retry.when`/`retry.exceptWhen` conditional expression evaluation
- Extracted `durationToMs()` into shared `duration.ts` utility for cross-module reuse
- Replaced opaque retry type casting in loader with structured `parseRetryConfig()` with full validation
- Created golden YAML #21 with 6 retry scenarios
- 45 new tests (30 delay calculator + 8 do-executor integration + 7 loader parsing)
- 413 total tests passing, zero regressions, `tsc --noEmit` clean

### Decisions Made

- **Scope**: Practical subset + `exceptWhen`. Deferred `Ref` (reusable policy references) and `limit.attempt.duration` (per-attempt timeout) — zero current demand, one needs document schema change, the other would break kernel Temporal-agnosticism
- **Backoff without delay defaults to 1s base**: When backoff is specified but delay is omitted, use 1-second base instead of multiplying zero
- **Retry success skips catch.do**: If a retry succeeds, result returns immediately without executing catch.do
- **Last error flows to catch on exhaustion**: Most recent error used for catch.as binding, not the first
- **Math.random() safe in sandbox**: Temporal patches it with deterministic PRNG; jitter replays identically

### Key Code Changes

- `workflow-engine/duration.ts`: New shared utility, extracts `durationToMs()` from wait.ts
- `workflow-engine/retry.ts`: Pure retry delay calculator (~108 lines)
- `workflow-engine/tasks/try.ts`: Rewritten with retry loop, shared `evaluateCondition` helper, `executeRetryLoop` function
- `workflow-engine/loader.ts`: Added `parseRetryConfig()` with 5 sub-parsers (duration, backoff, limit, jitter, config)
- `workflow-engine/types.ts`: Added `exceptWhen` field to `RetryConfig`
- `golden/21-retry-backoff.yaml`: 6 retry scenarios

### Next Session Plan

- Phase 6: Supporting Infrastructure (claimcheck, heartbeat, interceptors, OTel, event emission, budget tracking, notification provider registry, listen query/update event types)
