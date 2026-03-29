# T04: Phase Gate Relaxation — Allow Approval During Streaming

**Date**: March 29, 2026

## Summary

Relaxed the `SubmitApproval` phase validation in both Go (stigmer-server) and Java (stigmer-service) to accept approval submissions when the execution phase is `EXECUTION_IN_PROGRESS`, not just `EXECUTION_WAITING_FOR_APPROVAL`. This enables users to approve sub-agent tool calls while other sub-agents are still streaming, eliminating an unnecessary wait.

## Problem Statement

With parallel sub-agents, sub-agent 1 may need approval while sub-agents 2–4 are still executing. The tool call is visible in the UI with `TOOL_CALL_WAITING_APPROVAL` status, but the `SubmitApproval` RPC hard-rejects the request because the execution phase is `EXECUTION_IN_PROGRESS`.

### Pain Points

- Users see a tool call awaiting approval but cannot act on it
- Must wait for all sub-agents to finish streaming before approving anything
- Phase-centric validation treats a derived aggregate state as authoritative, when the tool call's own status is the real indicator

## Solution

Make validation **tool-call-centric** rather than **phase-centric**. The tool call's `TOOL_CALL_WAITING_APPROVAL` status is the authoritative indicator that approval is needed. The execution phase is a derived aggregate state that may lag behind individual tool call states.

**Allowed phases**: `EXECUTION_IN_PROGRESS` and `EXECUTION_WAITING_FOR_APPROVAL`. All terminal phases (`COMPLETED`, `FAILED`, `CANCELLED`, `TERMINATED`) and pre-start phases (`PENDING`, `PAUSED`) remain rejected.

## Implementation Details

### Go (stigmer-server)

- **`submit_approval.go`**: Changed single-phase equality check to allow both `EXECUTION_WAITING_FOR_APPROVAL` and `EXECUTION_IN_PROGRESS`. The rest of the validation (find tool call in messages, idempotency check, tool call status check) already works regardless of phase.
- **`submit_approval_contract_test.go`**: Added `makeExecutionWithPhase` helper and three new test sections: `TestApprovalAllowedDuringInProgress`, `TestApprovalRejectedDuringCompletedPhase`, `TestGateResolutionDuringInProgress` (with subtests for all-decided and REJECT during streaming).

### Java (stigmer-service)

- **`AgentExecutionSubmitApprovalHandler.java`**: Two changes:
  1. Phase gate: Route `IN_PROGRESS` to the main validation path instead of `handleNonWaitingPhase()`.
  2. `handleNotInPendingApprovals()`: Added tool-call-centric fallback — if a tool call has `TOOL_CALL_WAITING_APPROVAL` status and `UNSPECIFIED` approval_action, allow the approval even when `pending_approvals` projection is stale. This also benefits `WAITING_FOR_APPROVAL` phase during brief recomputation lag.
- **`AgentExecutionSubmitApprovalHandlerTest.java`**: Added two helper methods (`buildExecutionInProgress`, `buildExecutionInProgressWithPendingApproval`) and two nested test classes: `PhaseGateRelaxationTests` (5 tests) and `SignalDuringStreamingTests` (2 tests).

### Python (agent-runner)

No changes needed. `extract_approval_decisions_from_execution()` is phase-agnostic — it scans all tool calls for non-`UNSPECIFIED` `approval_action`, so pre-approved decisions from streaming are found naturally during DB-driven resume.

### Signal Behavior

Unchanged. The `approvalGateResolved` signal is sent on REJECT or all-decided, regardless of phase. Temporal buffers signals that arrive before the workflow enters the approval loop. A rare spurious wake-up (one extra no-op Python invocation) is possible in multi-cycle scenarios; correctness is unaffected.

## Benefits

- Users can approve tool calls immediately as they appear, without waiting for all parallel sub-agents to finish
- Reduces latency in the approval-to-resume cycle for multi-agent executions
- Tool-call-centric validation is more robust against phase staleness

## Impact

- **Backend**: Go and Java `SubmitApproval` handlers accept a broader set of valid states
- **Frontend**: No changes — the UI already shows tool calls with `TOOL_CALL_WAITING_APPROVAL` status; it will now be able to submit approvals earlier
- **Deployment**: Compatible with the T01–T03 big-bang deployment — no additional migration needed
- **Field ownership**: Fully compatible with T02 preservation — `update_status` preserves approval fields set during streaming

## Related Work

- T01: Atomic SubmitApproval — prerequisite (concurrent approval safety)
- T02: update_status Approval Preservation — prerequisite (streaming won't overwrite pre-approved decisions)
- T03: DB-Driven Resume — prerequisite (Python reads decisions from DB, not Temporal args)
- Frontend dismiss grace removal (Session 4) — related cleanup

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour implementation (Session 5)
