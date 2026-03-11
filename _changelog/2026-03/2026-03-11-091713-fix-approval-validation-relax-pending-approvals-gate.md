# Fix Approval Validation: Relax pending_approvals Gate for DB Consistency Lag

**Date**: March 11, 2026

## Summary

Relaxed the `pending_approvals` validation gate in the `SubmitApproval` RPC handler (both Go and Java) to tolerate DB consistency lag. Previously, if the CLI submitted an approval before the DB had received the `pending_approvals` from the Python activity's progressive update, the handler returned `FailedPrecondition: no pending approvals` — a permanent failure that the CLI did not retry. The handler now proceeds to signal the Temporal workflow when `pending_approvals` is empty but the execution phase is `WAITING_FOR_APPROVAL`, and the CLI now retries this specific `FailedPrecondition` as a transient error.

## Problem Statement

After applying two earlier fixes today (immediate `pending_approvals` population during streaming, and `run_id`-based interrupt matching with Temporal activity persistence), the "has no pending approvals" error continued to appear. The root cause is architectural: the RPC handler validates against the DB (an eventually-consistent read model), but the Temporal workflow is the actual source of truth for pending approval state.

### Pain Points

- The DB has at least 3 asynchronous write paths for `pending_approvals` (progressive gRPC, `persistFinalStatus`, concurrent sub-agent updates), each racing with the CLI's approval submission
- No matter how fast these writes are, a race window always exists because the DB is eventually consistent
- The CLI classified `FailedPrecondition` as non-retryable, so the error was permanent on first occurrence
- The handler's comment incorrectly called DB `pending_approvals` the "sole source of truth"

## Solution

Three complementary changes across the Go handler, Java handler, and CLI:

1. **Relax Gate 3 (pending_approvals non-empty)** — When the DB has `phase=WAITING_FOR_APPROVAL` but empty `pending_approvals`, log a warning and proceed to signal the Temporal workflow instead of returning `FailedPrecondition`
2. **Preserve Gate 4 as best-effort** — When `pending_approvals` IS populated, still validate `tool_call_id` against it; skip validation when data is unavailable
3. **CLI defense-in-depth** — Make `FailedPrecondition` with "no pending approvals" retryable with exponential backoff

## Implementation Details

### Go handler (`submit_approval.go`)

Replaced the hard `FailedPrecondition` error at the empty-`pending_approvals` check with a `Warn`-level log that allows execution to continue to the `SignalWorkflow` step. The `tool_call_id` validation is now inside an `else` branch — only runs when `pending_approvals` is available. Fixed the misleading "sole source of truth" comment to correctly document that the Temporal workflow holds the actual source of truth.

### Java handler (`AgentExecutionSubmitApprovalHandler.java`)

Same structural change: the `ValidateApprovalStep` now logs a warning and continues when `pendingApprovals.isEmpty()` rather than returning `FAILED_PRECONDITION`. The `MATCHED_PENDING_APPROVAL_KEY` context storage and `tool_call_id` validation are preserved inside the `else` branch. The downstream `BuildResponseStep` already handles null `matchedApproval` gracefully.

### CLI (`run_stream_events.go`)

Added a `codes.FailedPrecondition` case to `isRetryableSubmitError` that checks whether the error message contains "no pending approvals". If so, the error is classified as retryable, giving the DB time to catch up across the 3 retry attempts with exponential backoff (1s, 2s, 4s).

## Benefits

- Eliminates the "has no pending approvals" failure for users by tolerating DB consistency lag
- The Temporal workflow (source of truth) receives the signal regardless of DB state
- CLI retries act as a safety net even if the server-side relaxation is bypassed (e.g., older server version)
- Correctly documents the source-of-truth relationship between the DB and Temporal workflow

## Impact

- **Go Backend** (`stigmer-server`): `ValidateApproval` step no longer blocks on DB consistency for `pending_approvals`
- **Java Backend** (`stigmer-service`): Same relaxation applied
- **CLI**: `isRetryableSubmitError` now retries "no pending approvals" errors with backoff
- **No changes** to Temporal workflow logic, Python activity logic, proto definitions, or APIs

## Related Work

- Changelog: `2026-03-11-054853-fix-sub-agent-approval-race-no-pending-approvals` (immediate population fix)
- Changelog: `2026-03-11-081756-fix-approval-validation-tool-call-id-mismatch` (run_id matching + persistence fix)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
