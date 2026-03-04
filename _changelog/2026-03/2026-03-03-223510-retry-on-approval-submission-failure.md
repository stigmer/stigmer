# Retry on Approval Submission Failure

**Date**: March 3, 2026

## Summary

Added retry with exponential backoff to the approval submission path so that a transient gRPC failure no longer permanently strands an execution in `WAITING_FOR_APPROVAL`. The user's approval decision is retried up to 3 times with 1s/2s backoff, and on final failure the error message includes a re-attach command with the session ID. All three output modes (TUI, inline, JSON) benefit since they share the same submission path.

## Problem Statement

`emitAndWaitApproval` made a single attempt to submit the user's approval decision via `submitAgentApproval`. A transient network glitch, server restart, or resource exhaustion would silently lose the user's decision, leaving the execution permanently stuck in `WAITING_FOR_APPROVAL` with no recovery path except manual re-attach.

### Pain Points

- Single-attempt submission: one transient error = permanently stuck execution
- User's carefully considered approve/reject decision lost on network blip
- Error message was generic ("failed to submit approval decision") with no recovery instructions
- All three output modes (TUI, inline, JSON) were equally vulnerable

## Solution

Two pure, independently testable functions added to `run_stream_events.go`:

1. **`isRetryableSubmitError`** classifies gRPC errors as transient (retry) vs permanent (stop). Walks the `Unwrap()` chain to find gRPC status codes through wrapped errors.
2. **`retryWithBackoff`** is a generic retry loop with exponential backoff and context-aware sleep.

`emitAndWaitApproval` wraps `submitAgentApproval` in `retryWithBackoff` with a closure. On final failure, the `StreamErrorEvent` includes the retry count and a re-attach command.

## Implementation Details

### Error Classification (`isRetryableSubmitError`)

- **Retryable** (transient): `Unavailable`, `DeadlineExceeded`, `ResourceExhausted`, `Aborted`, `Internal`, `Unknown`
- **Non-retryable** (permanent): `NotFound`, `InvalidArgument`, `PermissionDenied`, `Unauthenticated`, `FailedPrecondition`, `AlreadyExists`, `Canceled`
- **Non-gRPC errors** (raw network/io): default to retryable
- Walks the `Unwrap()` chain via interface type assertion to find gRPC status through `fmt.Errorf` wrapping, avoiding import conflict with `github.com/pkg/errors`

### Retry Loop (`retryWithBackoff`)

- Context-aware at two checkpoints: `ctx.Err()` gate before each attempt, `select` with `ctx.Done()` during backoff sleep
- Exponential backoff: `baseDelay * 2^attempt` (1s, 2s for 3 attempts)
- Stops early on non-retryable error (per `isRetryableSubmitError`)
- Debug-logs each retry with attempt number, max attempts, and next delay

### Error Message Improvement

Before: `"failed to submit approval decision"` (no session ID, no retry count)
After: `"Failed to submit approval after 3 attempts. Re-attach to retry: stigmer run ses-xxx"` (actionable, includes session ID when available)

### Constants

- `approvalRetryMaxAttempts = 3` (1 original + 2 retries)
- `approvalRetryBaseDelay = 1s` (doubles each attempt: 1s, 2s)
- Worst-case total wait: 3s before giving up

## Benefits

- Transient network errors no longer permanently strand executions
- User's approval decision survives brief server unavailability or restarts
- Permanent errors (NotFound, PermissionDenied) fail fast without wasting time on futile retries
- Actionable error message with session ID enables recovery when retries are exhausted
- All three output modes (TUI, inline, JSON) automatically benefit

## Impact

- **Users**: Approval flow is more resilient to transient failures. Recovery path is clearly communicated when retries are exhausted.
- **Maintainers**: `retryWithBackoff` and `isRetryableSubmitError` are pure functions, independently testable, and reusable for future retry needs.
- **Scope**: Only the agent approval submission path (`emitAndWaitApproval`). Workflow approvals (`submitWorkflowApproval`) are a separate code path and were not modified.

## Related Work

- Phase 1.2: Context-Cancellable Approval Flow (established `trySendEvent` and cancellable `select` patterns)
- Phase 1.3: Dead Stream Connection Detection (established `classifyStreamError` and error chain walking patterns)
- Phase 2.1: Comprehensive Error Handler (established `extractGRPCStatus` and gRPC code classification in `clierr`)

---

**Status**: Production Ready
**Tests**: 13 new unit tests (7 for `isRetryableSubmitError`, 6 for `retryWithBackoff`) -- all passing alongside full existing suite
