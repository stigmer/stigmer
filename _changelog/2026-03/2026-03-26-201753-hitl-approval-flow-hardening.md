# HITL Approval Flow Hardening: Formal State Machine and Module Extraction

**Date**: March 26, 2026

## Summary

Introduced a formal `ApprovalLifecycleState` state machine across the entire HITL approval pipeline (Python, Go, Java, React), extracted the HITL logic from the 4,284-line `execute_graphton.py` into a dedicated testable module, and added cross-boundary contract tests and a UI poll-based fallback. This addresses the root causes behind four consecutive HITL fixes in a single day by making the approval flow structurally correct rather than patching symptoms.

## Problem Statement

Four HITL approval fixes were shipped in rapid succession on March 26, each exposing the next bug:

1. **17:43** — Stale idempotency check suppressed the Temporal signal
2. **18:29** — INTERRUPT_CAPTURE matched wrong `tool_call_id` across cycles; message-embedded copies not synced
3. **19:33** — Go/Java deleted `pending_approvals` before Python could read them
4. **19:44** — Swapped positional arguments in the fix from 19:33

### Pain Points

- Approval state was represented in 6 places (flat tool calls, message-embedded copies, pending_approvals, LangGraph interrupts, Temporal decisions, UI-derived state) with none authoritative
- Cross-service data dependencies were implicit — documented in code comments that lied
- The `execute_graphton.py` file (4,284 lines) made it nearly impossible to reason about the full HITL state space
- No cross-service contract tests existed — all tests were within single service boundaries
- Positional arguments in Python HITL methods enabled an entire class of swap bugs

## Solution

A three-phase architectural hardening:

1. **Formal State Machine** — Proto-level `ApprovalLifecycleState` enum with forward-only invariant, making `PendingApproval` the single source of truth
2. **Module Extraction** — Dedicated `graphton/hitl.py` with focused, testable classes
3. **Contract Tests and UI Resilience** — Cross-boundary tests and poll-based fallback

## Implementation Details

### Phase 1: Proto-Level State Machine

Added `ApprovalLifecycleState` enum to `approval.proto`:

```
UNSPECIFIED → REQUESTED → INTERRUPT_CAPTURED → DECISION_RECORDED → RESUME_RECONCILED → CLEARED
```

Each state is owned by exactly one service:
- `REQUESTED` — Python `_populate_pending_approval`
- `INTERRUPT_CAPTURED` — Python INTERRUPT_CAPTURE
- `DECISION_RECORDED` — Go/Java `RecordApprovalDecisionStep`
- `RESUME_RECONCILED` — Python RESUME_RECONCILE
- `CLEARED` — Python clear-signal sentinel

Three new fields on `PendingApproval`: `lifecycle_state`, `decision_action`, `decision_recorded_at`. The `ToolCall.approval_action` field is now a projection of `PendingApproval.decision_action`.

**Idempotency fix**: The Go `validateApprovalStep` now checks `PendingApproval.lifecycle_state` first (the authoritative record) before falling back to `ToolCall.approval_action` (legacy path). This structurally prevents the stale-idempotency bug that started the cascade.

**Keyword-only arguments**: `_update_tool_call_on_ai_message` now uses `*` for ALL parameters. All 7 call sites updated to named arguments — positional swap bugs are now a compile-time error.

### Phase 2: HITL Module Extraction

Created `graphton/hitl.py` with four focused classes:

- **`ApprovalStateManager`** — Enforces forward-only lifecycle transitions; raises `ValueError` on backward moves
- **`InterruptCapture`** — Encapsulates Priority 1/2/3 matching with pluggable `_match_interrupt` method
- **`ResumeReconciler`** — Encapsulates tool call reconciliation, message sync, auto-skip, and clear-signal
- **`CheckpointFallback`** — Defense-in-depth interrupt discovery from LangGraph checkpoint

Each class has explicit dependencies (no globals, no closure captures) and a clear single responsibility.

### Phase 3: Contract Tests and Observability

**Python contract tests** (`test_hitl_contracts.py`): 13 tests across 5 classes verifying INTERRUPT_CAPTURE output shape, DECISION_RECORDED invariants, clear-signal sentinel, UI actionability rules, and forward-only lifecycle invariant.

**Go contract tests** (`submit_approval_contract_test.go`): 4 tests verifying pending_approvals preservation, clear-signal convention, lifecycle ordering, and update-status clear path.

**Structured tracing**: All lifecycle transitions emit `[LIFECYCLE]` logs with `execution_id`, `tool_call_id`, `from_state`, `to_state`, `service` — enabling "show me all transitions for execution X" diagnostic queries.

**UI poll-based fallback**: When `useSessionConversation` detects `WAITING_FOR_APPROVAL` phase with empty `pendingApprovals` for 3 seconds, it refetches the execution. This is a UX safety net that prevents the user from being stuck without an action available.

## Benefits

- **Structural correctness**: Bugs at service boundaries are now caught by contract tests and prevented by the forward-only lifecycle invariant
- **Diagnosability**: `lifecycle_state` immediately shows which service last touched a stuck approval — no log correlation required
- **Maintainability**: HITL logic is now in focused, testable classes instead of buried in a 4,284-line file
- **Regression prevention**: Keyword-only arguments eliminate positional swap bugs at the language level
- **User resilience**: The poll-based fallback ensures users are never stuck without an approval action

## Impact

- **Proto**: `approval.proto` — New enum, 3 new fields on `PendingApproval`
- **Python**: `execute_graphton.py`, `status_builder.py` — Lifecycle state set at each phase; keyword-only args
- **Python**: New `graphton/hitl.py` — 4 extracted classes (~790 lines)
- **Go**: `submit_approval.go` — Lifecycle-aware validation and decision recording
- **Java**: `AgentExecutionSubmitApprovalHandler.java` — Lifecycle state advancement
- **React**: `useSessionConversation.ts` — Poll-based fallback for approval state
- **Tests**: 17 new contract tests across Python and Go

## Related Work

- `2026-03-26-174359-fix-hitl-approval-stale-idempotency-short-circuit.md` — Root cause: stale idempotency (addressed by lifecycle-first validation)
- `2026-03-26-182903-fix-hitl-approval-matching-reconciliation-ui.md` — Root cause: no single source of truth (addressed by lifecycle state machine)
- `2026-03-26-193343-fix-hitl-resume-race-condition.md` — Root cause: implicit data dependency (addressed by formal contracts)
- `2026-03-26-194430-fix-hitl-resume-reconcile-argument-order.md` — Root cause: positional args (addressed by keyword-only)

---

**Status**: ✅ Production Ready
**Timeline**: Architectural hardening following 4 cascading HITL fixes
