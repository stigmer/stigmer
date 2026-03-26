# Tasks: 20260326.02.hitl-approval-flow-hardening

**Created**: 2026-03-26

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

---

## Task 1: Route all lifecycle mutations through ApprovalStateManager.advance()

**Status**: ⏸️ TODO
**Created**: 2026-03-26 20:52
**Severity**: Medium (correctness risk)
**Files**: `backend/services/agent-runner/worker/activities/graphton/hitl.py`

### Problem

`ApprovalStateManager` exists and is injected into `InterruptCapture` as `self._sm`, but **neither `InterruptCapture` nor `ResumeReconciler` call `self._sm.advance()`**. Both directly assign `pa.lifecycle_state = ...`:

- `InterruptCapture` line 227: `existing_pa.lifecycle_state = INTERRUPT_CAPTURED`
- `InterruptCapture` line 258: `lifecycle_state=INTERRUPT_CAPTURED` (new PendingApproval constructor)
- `ResumeReconciler` line 584: `pa.lifecycle_state = RESUME_RECONCILED`
- `_try_enrich_phase1_entry` lines 783/788: same direct assignment

The forward-only invariant and structured `[LIFECYCLE]` logging are bypassed.

### Subtasks

- [ ] Replace direct `pa.lifecycle_state = INTERRUPT_CAPTURED` in `InterruptCapture.capture()` (line 227) with `self._sm.advance(pa, target_state=INTERRUPT_CAPTURED, service="InterruptCapture")`
- [ ] For new `PendingApproval` construction (line 249-259), call `advance()` after construction (can't use advance on uninitialized proto, so construct with REQUESTED first, then advance to INTERRUPT_CAPTURED)
- [ ] Inject `ApprovalStateManager` into `ResumeReconciler` and replace line 584's direct assignment
- [ ] Pass `ApprovalStateManager` to `_try_enrich_phase1_entry` or refactor it to be a method on a class that has access
- [ ] Update `test_hitl_contracts.py` to verify `advance()` is called (mock or assert lifecycle transitions)

### Notes

- `ApprovalStateManager.advance()` raises `ValueError` on backward transitions -- this is the safety net we want enforced
- The `_sm` reference is already stored in `InterruptCapture.__init__` but never used
- `ResumeReconciler` does NOT currently receive `state_manager` -- needs constructor change

---

## Task 2: Populate _fingerprint_to_tool_call_id for sub-agent tool calls

**Status**: ⏸️ TODO
**Created**: 2026-03-26 20:52
**Severity**: Medium (sub-agent HITL matching can fail)
**Files**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

### Problem

In `_handle_tool_start_event`, `tool_call_fingerprints` is populated for sub-agent tool calls (lines 1636-1646) but `_fingerprint_to_tool_call_id` is **not populated** for those entries (contrast lines 1626-1629 for top-level only). This means `InterruptCapture._match_interrupt` Priority 2 (fingerprint matching) always misses sub-agent tools and falls through to Priority 3 (name-based), which is order-dependent and fragile with multiple tools of the same name.

### Subtasks

- [ ] Find where `_fingerprint_to_tool_call_id` is populated for top-level tool calls in `_handle_tool_start_event`
- [ ] Add equivalent population for sub-agent tool calls in the same method
- [ ] Also update `populate_fingerprints_from_existing_tool_calls()` to include sub-agent tool calls
- [ ] Add a contract test verifying sub-agent fingerprints are in the map

### Notes

- Search for `_fingerprint_to_tool_call_id` assignments in `status_builder.py` to find all population sites
- The fingerprint is computed via `_get_tool_fingerprint(tool_name, tool_args)`

---

## Task 3: Convert single-shot poll fallback to repeating poll with exponential backoff

**Status**: ⏸️ TODO
**Created**: 2026-03-26 20:52
**Severity**: Low-Medium (user can get stuck)
**Files**: `sdk/react/src/session/useSessionConversation.ts`

### Problem

The poll-based fallback (lines 370-393) triggers a single `refetch()` after 3 seconds when `WAITING_FOR_APPROVAL` phase has empty `pendingApprovals`. If the refetch still returns empty, the `useEffect` deps don't change and the poll won't fire again. The user sees "Waiting for approval" with no approval cards and no action.

### Subtasks

- [ ] Replace single `setTimeout` with a `useRef`-based interval that uses exponential backoff (3s, 6s, 12s, capped at 30s)
- [ ] Clear the interval when `pendingApprovals` becomes non-empty or phase changes
- [ ] Consider adding a visible "Still loading approval details..." indicator after the first retry
- [ ] Test that the cleanup function properly clears intervals on unmount

### Notes

- The current `useEffect` deps are `[activePhase, pendingApprovals.length, activeExecutionId, refetch]`
- Key: `pendingApprovals.length` stays 0 across retries, so deps don't change -- this is why it's single-shot
- Solution: use a `retryCount` ref that increments to trigger re-renders, or use `setInterval` with a ref

---

## Task 4: Add staleness detection after optimistic dismissal

**Status**: ⏸️ TODO
**Created**: 2026-03-26 20:52
**Severity**: Medium (user gets stuck with no recovery)
**Files**: `sdk/react/src/session/useSessionConversation.ts`

### Problem

When `submitApproval` RPC succeeds, the approval card is immediately dismissed via `dismissedApprovalIds`. But if the Temporal signal fails downstream, the execution stays stuck in `WAITING_FOR_APPROVAL` with no visible approval cards. The user has no way to act.

### Subtasks

- [ ] Track `dismissedAt` timestamp alongside each `dismissedApprovalId`
- [ ] Add a `useEffect` that checks: if phase is still `WAITING_FOR_APPROVAL` and any `dismissedApprovalId` has been dismissed for > 15 seconds, remove it from dismissed set (card reappears)
- [ ] Optionally show a "Approval may not have been processed" message on the reappeared card
- [ ] Consider checking the `submitApproval` RPC return value (`AgentExecution`) for immediate phase detection

### Notes

- `dismissedApprovalIds` is currently `ReadonlySet<string>` -- may need to change to `Map<string, number>` for timestamps
- The stream should eventually deliver the updated state, but if it doesn't, this is the safety net
- Keep the optimistic dismissal for the happy path -- only reappear on timeout

---

## Task 5: Remove dead _remove_from_pending and improve batch resume visibility

**Status**: ⏸️ TODO
**Created**: 2026-03-26 20:52
**Severity**: Low (maintenance hygiene)
**Files**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`, `backend/services/agent-runner/worker/activities/execute_graphton.py`

### Subtasks

- [ ] Confirm `_remove_from_pending` has no production callers (grep for all references)
- [ ] Remove or add a `@deprecated` docstring with explanation of the clear-signal pattern that replaced it
- [ ] In `execute_graphton.py` batch resume abort (around lines 1757-1778), add a log line that would be visible in the execution's message stream (not just Python logs) when `loop_aborted = True`

### Notes

- The `_remove_from_pending` method was used in historical reject flows, replaced by `del pending_approvals[:]` + clear sentinel in `ResumeReconciler`
- Batch resume abort currently only logs to Python logger -- the user has no visibility

---

## Task 6: Validate fixes with contract tests and manual E2E testing

**Status**: ⏸️ TODO
**Created**: 2026-03-26 20:52
**Files**: `backend/services/agent-runner/tests/test_hitl_contracts.py`, `backend/services/agent-runner/tests/test_status_builder.py`

### Subtasks

- [ ] Add contract test: lifecycle transitions go through `advance()` (mock `ApprovalStateManager` and verify calls)
- [ ] Add contract test: sub-agent fingerprints appear in `_fingerprint_to_tool_call_id`
- [ ] Run existing test suites: `test_hitl_contracts.py`, `test_status_builder.py`, `test_checkpoint_validator.py`
- [ ] Manual test: approve a tool call in the UI and verify the full cycle completes
- [ ] Manual test: verify poll fallback fires multiple times (simulate slow DB by adding a sleep in dev)
- [ ] Run `make lint` on all changed files

---

## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked DONE
- [ ] `test_hitl_contracts.py` passes
- [ ] `test_status_builder.py` passes
- [ ] `make lint` passes for all changed files
- [ ] Manual E2E approval flow works
- [ ] Changelog entry created

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

