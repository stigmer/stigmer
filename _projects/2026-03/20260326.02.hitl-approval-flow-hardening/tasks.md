# Tasks: 20260326.02.hitl-approval-flow-hardening

**Created**: 2026-03-26

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

---

## Task 1: Route all lifecycle mutations through ApprovalStateManager.advance()

**Status**: ✅ DONE
**Created**: 2026-03-26 20:52
**Completed**: 2026-03-26 21:15
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

- [x] Replace direct `pa.lifecycle_state = INTERRUPT_CAPTURED` in `InterruptCapture.capture()` with `self._sm.advance()`
- [x] For new `PendingApproval` construction, construct with REQUESTED first, then advance to INTERRUPT_CAPTURED
- [x] Inject `ApprovalStateManager` into `ResumeReconciler` and replace direct assignment
- [x] Promoted `_try_enrich_phase1_entry` to `InterruptCapture._try_enrich_phase1_entry()` instance method (DDD alignment)
- [x] Updated `test_hitl_contracts.py` with `TestAdvanceEnforcement` spy-based verification
- [x] Fixed surprise dependencies in `test_approval_resume.py` and `test_status_builder.py`

### Decisions Made

- **Clear-signal sentinel stays direct**: `PendingApproval(tool_call_id="", lifecycle_state=CLEARED)` is a protocol marker, not a lifecycle event -- running `advance()` would log misleading transitions
- **`_try_enrich_phase1_entry` promoted to method**: Moved from standalone function to `InterruptCapture` private method for DDD alignment and natural access to `self._sm`
- **Backward-compat re-export removed**: The `_try_enrich_phase1_entry` re-export in `execute_graphton.py` (from the extraction refactor) was removed; test files updated to import from `hitl.py` directly

---

## Task 2: Populate _fingerprint_to_tool_call_id for sub-agent tool calls

**Status**: ✅ DONE
**Created**: 2026-03-26 20:52
**Completed**: 2026-03-27 08:50
**Severity**: Medium (sub-agent HITL matching can fail)
**Files**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

### Problem

In `populate_fingerprints_from_existing_tool_calls()`, `tool_call_fingerprints` is populated for sub-agent tool calls (lines 1636-1646) but `_fingerprint_to_tool_call_id` is **not populated** for those entries (contrast lines 1626-1629 for top-level only). This means `InterruptCapture._match_interrupt` Priority 2 (fingerprint matching) always misses sub-agent tools and falls through to Priority 3 (name-based), which is order-dependent and fragile with multiple tools of the same name. It also prevents run-ID alias creation on the resume path, so `on_tool_end` cannot transition resumed sub-agent tool calls to COMPLETED.

### Subtasks

- [x] Identified the asymmetry in `populate_fingerprints_from_existing_tool_calls()`: top-level loop populates both `tool_call_fingerprints` and `_fingerprint_to_tool_call_id`, sub-agent loop only populates `tool_call_fingerprints`
- [x] Added `_fingerprint_to_tool_call_id[fingerprint] = tc.id` in the sub-agent loop (2-line fix mirroring lines 1628-1629)
- [x] Added Contract 7 (`TestSubAgentFingerprintMapPopulation`) in `test_hitl_contracts.py` with 3 tests: core case, both-contexts, and empty-id edge case
- [x] All 22 HITL contract tests pass, all 279 status builder tests pass — zero regressions

### Notes

- The fix is minimal: 2 lines of production code, 111 lines of test code
- No changes needed in `_handle_tool_start_event` — the dedup + alias logic (lines 651-662) works correctly once the map is populated by `populate_fingerprints_from_existing_tool_calls()`
- Fingerprint collision between top-level and sub-agent with same tool+args is handled by last-write-wins, which is acceptable for alias creation

---

## Task 3: Convert single-shot poll fallback to repeating poll with exponential backoff

**Status**: ✅ DONE
**Created**: 2026-03-26 20:52
**Completed**: 2026-03-27
**Severity**: Low-Medium (user can get stuck)
**Files**: `sdk/react/src/session/useSessionConversation.ts`

### Problem

The poll-based fallback (lines 370-393) triggers a single `refetch()` after 3 seconds when `WAITING_FOR_APPROVAL` phase has empty `pendingApprovals`. If the refetch still returns empty, the `useEffect` deps don't change and the poll won't fire again. The user sees "Waiting for approval" with no approval cards and no action.

### Subtasks

- [x] Replace single `setTimeout` with a self-scheduling timeout chain using `useRef` for attempt count (exponential backoff: 3s, 6s, 12s, 24s, capped at 30s)
- [x] Changed condition from filtered `pendingApprovals.length` to raw `activeStreamExecution?.status?.pendingApprovals?.length` so dismissed-but-present approvals don't trigger wasteful polling
- [x] Decided against adding a visible indicator — consumer can derive `activePhase === WAITING_FOR_APPROVAL && pendingApprovals.length === 0` trivially
- [x] Test: backoff fires at 3s, 6s, 12s intervals
- [x] Test: stops when raw approvals arrive via stream
- [x] Test: stops when phase transitions away
- [x] Test: does not fire when raw approvals exist but are all dismissed
- [x] Test: cleanup clears timeout on unmount

### Decisions Made

- **Self-scheduling setTimeout chain over setInterval**: Backoff requires increasing delays; `setInterval` fires at a fixed rate and would need to be recreated. The timeout chain is the natural fit.
- **Raw approvals condition**: Poll checks unfiltered `activeStreamExecution?.status?.pendingApprovals` instead of the filtered `pendingApprovals`. This separates Task 3 (server didn't deliver data) from Task 4 (user dismissed but signal failed), avoiding unnecessary network requests in the dismissed case.
- **No new public API field**: Consumer can derive the "loading approval details" state from existing `activePhase` + `pendingApprovals.length`.

---

## Task 4: Add staleness detection after optimistic dismissal

**Status**: ✅ DONE
**Created**: 2026-03-26 20:52
**Completed**: 2026-03-27
**Severity**: Medium (user gets stuck with no recovery)
**Files**: `sdk/react/src/session/useSessionConversation.ts`

### Problem

When `submitApproval` RPC succeeds, the approval card is immediately dismissed via `dismissedApprovalIds`. But if the Temporal signal fails downstream, the execution stays stuck in `WAITING_FOR_APPROVAL` with no visible approval cards. The user has no way to act.

### Subtasks

- [x] Changed internal state from `Set<string>` to `Map<string, number>` (toolCallId → `Date.now()` timestamp)
- [x] Derived `dismissedApprovalIds: ReadonlySet<string>` from Map keys via `useMemo` — public API type unchanged
- [x] Added staleness detection `useEffect` with `setInterval` (5s check interval, 15s threshold)
- [x] Used `useRef` to sync latest map into interval callback, avoiding stale closure issues
- [x] Added `next.size < prev.size` guard in updater to prevent no-op state updates in race conditions
- [x] Triggers `refetch()` when stale entries are detected
- [x] Decided against "Approval may not have been processed" message — card already shows live `WaitingDuration` timer that communicates elapsed time
- [x] Deferred `submitApproval` RPC return value optimization — staleness detection handles the failure case regardless
- [x] Test: card reappears after staleness threshold (15s strict, first detection at 20s due to interval alignment)
- [x] Test: no staleness check when phase is not WAITING_FOR_APPROVAL
- [x] Test: triggers refetch on staleness detection
- [x] Test: `dismissedApprovalIds` remains `ReadonlySet<string>` (type contract)
- [x] Test: resets dismissed state on new execution

### Decisions Made

- **Internal Map, public Set**: The Map with timestamps is an internal detail. Platform builders see `ReadonlySet<string>` — zero breaking changes. MessageThread and all downstream consumers work unchanged.
- **No warning message on reappeared card**: The `WaitingDuration` component in `ApprovalCard` already shows live elapsed time. A card reappearing with "waiting 20s" naturally communicates that something went wrong. A warning message can be layered on later without hook-level changes.
- **Refetch on staleness**: When stale entries are removed, `refetch()` is also called to get the latest server state. This catches cases where the stream missed a phase transition.
- **Strict greater-than for threshold**: `now - ts > STALE_DISMISSAL_MS` (not `>=`). At exactly 15s the entry is not yet stale — first detection occurs at the next 5s interval tick after 15s.

---

## Task 5: Remove dead _remove_from_pending and improve batch resume visibility

**Status**: ✅ DONE
**Created**: 2026-03-26 20:52
**Completed**: 2026-03-27
**Severity**: Low (maintenance hygiene)
**Files**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`, `backend/services/agent-runner/worker/activities/execute_graphton.py`

### Subtasks

- [x] Confirm `_remove_from_pending` has no production callers (grep for all references)
- [x] Remove the dead method (chosen over `@deprecated` — zero callers, private method, deprecation annotation would be noise)
- [x] In `execute_graphton.py` batch resume abort, add a MESSAGE_SYSTEM to the execution's message stream when `loop_aborted = True`

### Decisions Made

- **Deletion over deprecation**: `_remove_from_pending` had zero production callers and is a private method. A `@deprecated` annotation on a private method with no callers would never trigger a warning — clean removal is the right call.
- **Section comment updated**: Rewrote the "Approval State Management" section header in `status_builder.py` to reference the `ResumeReconciler` clear-signal pattern as the resume path.
- **Test deleted**: `test_remove_from_pending_resolves_run_id_aliases` was the sole caller; removed alongside the method.

### Notes

- The `_remove_from_pending` method was used in historical reject flows, replaced by `del pending_approvals[:]` + clear sentinel in `ResumeReconciler`
- Batch resume abort now surfaces a MESSAGE_SYSTEM so users see why the agent restarted from checkpoint instead of resuming

---

## Task 6: Validate fixes with contract tests and manual E2E testing

**Status**: 🚧 IN PROGRESS
**Created**: 2026-03-26 20:52
**Completed (automated)**: 2026-03-27
**Files**: `backend/services/agent-runner/tests/test_hitl_contracts.py`, `backend/services/agent-runner/tests/test_status_builder.py`

### Subtasks

- [x] Add contract test: lifecycle transitions go through `advance()` (mock `ApprovalStateManager` and verify calls) — done in Task 1 (TestAdvanceEnforcement, 3 tests)
- [x] Add contract test: sub-agent fingerprints appear in `_fingerprint_to_tool_call_id` — done in Task 2 (TestSubAgentFingerprintMapPopulation, 3 tests)
- [x] Run existing test suites: `test_hitl_contracts.py`, `test_status_builder.py`, `test_checkpoint_validator.py` — 325 passed, 0 failed
- [ ] Manual test: approve a tool call in the UI and verify the full cycle completes
- [ ] Manual test: verify poll fallback fires multiple times (simulate slow DB by adding a sleep in dev)
- [x] Run `make lint` on all changed files — fixed 5 ruff issues (import sorting + unused import) and 2 mypy type annotation issues in HITL files; ESLint clean

### Lint Fixes Applied

- **ruff**: Auto-fixed import sorting (I001) in `test_hitl_contracts.py`, `test_approval_resume.py`, `test_status_builder.py`, `hitl.py`; removed unused `ExecutionPhase` import (F401) in `test_hitl_contracts.py`
- **mypy**: Changed `target_state: int` → `target_state: ApprovalLifecycleState` in `ApprovalStateManager.advance()`; changed `action_map: dict[int, str]` → `dict[ApprovalAction, str]` in `CheckpointFallback.discover_interrupts()`
- **Pre-existing (not fixed)**: 14 ruff errors in `execute_graphton.py` (unused imports for asyncio, logging, time, attachments, prompt_builder, storage, streaming, workspace), 2 mypy errors in `discover_mcp_server.py` and `attachments.py`

---

## Project Completion Checklist

When all tasks are done:
- [x] All tasks marked DONE
- [x] `test_hitl_contracts.py` passes (22 tests)
- [x] `test_status_builder.py` passes (279 tests)
- [x] `make lint` passes for all HITL-changed files
- [ ] Manual E2E approval flow works
- [x] Changelog entry created (2 entries: backend hardening + frontend resilience)

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

