# Workflow Engine Phase 5.1b: CNCF Catch-Level Retry

**Date**: May 20, 2026

## Summary

Implemented CNCF Serverless Workflow catch-level retry in the TypeScript workflow engine — a net-new feature that the Go reference implementation never built. The retry system re-executes failed `try` task lists with configurable delay, backoff strategies (constant/exponential/linear), jitter, attempt count and duration limits, and conditional retry expressions (`when`/`exceptWhen`). 45 new tests, 413 total passing, zero regressions.

## Problem Statement

Phase 5.1 delivered `try/catch` with `raise`, but the `catch.retry` field was parsed and stored without being executed. The CNCF Serverless Workflow spec defines a comprehensive retry policy on `catch` blocks, but the Go workflow-runner (`task_builder_try.go`) never implemented it — retry in Go was purely Temporal activity-level retry via metadata. This left a gap: workflow authors had no way to retry an entire task sequence on failure with configurable backoff.

### Pain Points

- No catch-level retry despite types and parsing being in place since Phase 5.1
- Workflow authors had to implement manual retry patterns (counter + for loop) for transient failures
- No jitter support meant thundering-herd risk for concurrent workflow instances
- Go parity was irrelevant here — Go never built this feature

## Solution

Implemented the CNCF retry spec directly, scoped to a practical subset that covers all real-world patterns:

- **Delay**: Base delay from `DurationDef` (days/hours/minutes/seconds/milliseconds)
- **Backoff**: Three strategies — `constant` (same delay), `exponential` (2^(n-1)), `linear` (n * delay)
- **Jitter**: Random offset in `[from, to]` range, sandbox-safe via Temporal's deterministic `Math.random()`
- **Limits**: `limit.attempt.count` (max retries) and `limit.duration` (max total delay budget)
- **Conditional**: `retry.when` (retry if truthy) and `retry.exceptWhen` (skip retry if truthy) with `$error` binding

Deferred `Ref` (reusable policy references, needs document-level schema change with zero demand) and `limit.attempt.duration` (per-attempt timeout, would break kernel Temporal-agnosticism).

## Implementation Details

### Architecture

The retry loop lives entirely in the Temporal-agnostic kernel (`workflow-engine/`):

- **`retry.ts`**: Pure `computeRetryDelay(attempt, config, elapsedMs)` function — resolves base delay, applies backoff multiplier, adds jitter, checks limits. Returns `null` when limits exceeded.
- **`tasks/try.ts`**: `executeRetryLoop()` function called after error matching passes. Re-executes the try block with `ctx.sleep(delay)` between attempts. On success, returns immediately (catch.do skipped). On exhaustion, falls through to existing catch logic with the last error.
- **`duration.ts`**: Extracted `durationToMs()` from `tasks/wait.ts` into a shared utility to avoid cross-module coupling between retry and wait task builders.

### Retry Position in Catch Flow

```
try block fails → normalize to WorkflowError →
  catch.errors.with filter → catch.when expression →
    [NEW] retry.when/exceptWhen → computeRetryDelay → ctx.sleep → re-execute try →
      on success: return result (skip catch.do)
      on exhaustion: catch.as binding → catch.do execution
```

### Parsing

Replaced opaque `catchRaw.retry as CatchConfig["retry"]` in `parseCatchConfig()` with structured `parseRetryConfig()` that validates:
- Backoff mutual exclusion (only one of constant/exponential/linear)
- Positive integer attempt counts
- DurationDef fields for delay, jitter.from/to, limit.duration

### Files Changed

| Action | File | Description |
|--------|------|-------------|
| Create | `workflow-engine/duration.ts` | Shared `durationToMs()` utility |
| Create | `workflow-engine/retry.ts` | Pure retry delay calculator |
| Create | `workflow-engine/__tests__/retry.test.ts` | 30 unit tests |
| Create | `golden/21-retry-backoff.yaml` | 6 retry scenarios |
| Modify | `workflow-engine/types.ts` | Added `exceptWhen` to `RetryConfig` |
| Modify | `workflow-engine/tasks/try.ts` | Retry loop + shared expression helper |
| Modify | `workflow-engine/tasks/wait.ts` | Import from shared duration.ts |
| Modify | `workflow-engine/loader.ts` | Structured retry parsing |
| Modify | `__tests__/do-executor.test.ts` | 8 integration tests |
| Modify | `__tests__/loader.test.ts` | 8 parsing tests |

## Benefits

- **Production-ready retry**: Workflow authors can now add `catch.retry` with full backoff/jitter/limits instead of manual retry patterns
- **Exceeds Go**: Go never implemented this; our TypeScript engine is the first Stigmer implementation of CNCF catch-level retry
- **Kernel purity maintained**: No new Temporal imports, no new `TaskExecutionContext` callbacks
- **Comprehensive testing**: 30 unit tests for delay calculator covering all backoff strategies, jitter ranges, limit checks, and edge cases

## Impact

- **Workflow authors**: Can now declare retry policies directly in YAML `catch.retry` blocks
- **Platform reliability**: Exponential backoff + jitter for transient failures (HTTP 503, rate limits, timeouts)
- **Test suite**: 413 total tests (up from 368), 45 new tests added

## Related Work

- Phase 5.1: try/catch + raise (foundation for retry)
- Phase 5.3: wait task + `ctx.sleep()` callback (prerequisite for retry delays)
- Changelog: `2026-05-20-162823-workflow-engine-phase5-1-try-catch-raise.md`

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
