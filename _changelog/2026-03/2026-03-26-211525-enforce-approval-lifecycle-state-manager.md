# Enforce ApprovalStateManager.advance() on All Lifecycle Mutations

**Date**: March 26, 2026

## Summary

Eliminated four bypass sites where `PendingApproval.lifecycle_state` was mutated via direct assignment, routing all transitions through `ApprovalStateManager.advance()`. This enforces the forward-only invariant and activates structured `[LIFECYCLE]` logging across the entire HITL approval pipeline.

## Problem Statement

`ApprovalStateManager` was designed to be the single gateway for lifecycle transitions on `PendingApproval` records. It enforces a strict forward-only invariant (`REQUESTED -> INTERRUPT_CAPTURED -> DECISION_RECORDED -> RESUME_RECONCILED -> CLEARED`) and emits structured `[LIFECYCLE]` logs for every transition.

### Pain Points

- `InterruptCapture.capture()` directly assigned `lifecycle_state = INTERRUPT_CAPTURED` on two code paths (enriching existing Phase 1 entries, and constructing new PAs), bypassing the guard entirely
- `ResumeReconciler.reconcile()` directly assigned `lifecycle_state = RESUME_RECONCILED` without validation or logging
- The standalone `_try_enrich_phase1_entry()` function assigned lifecycle state directly on both its strict and relaxed matching passes
- The `_sm` reference was already wired into `InterruptCapture.__init__` but never actually called — the safety net existed but was disconnected

## Solution

Route every `lifecycle_state` mutation through `ApprovalStateManager.advance()`, inject the state manager into `ResumeReconciler`, and promote the standalone enrichment function into a method on `InterruptCapture` where it naturally gains access to the state manager.

## Implementation Details

### hitl.py — Core enforcement (4 bypass sites fixed)

- **InterruptCapture.capture() — existing PA enrichment**: Replaced `existing_pa.lifecycle_state = INTERRUPT_CAPTURED` with `self._sm.advance(existing_pa, target_state=INTERRUPT_CAPTURED, service="InterruptCapture")`
- **InterruptCapture.capture() — new PA construction**: Changed constructor to use `lifecycle_state=REQUESTED`, append the PA to the list, then `advance()` to `INTERRUPT_CAPTURED`. This preserves the full audit trail for PAs that skip Phase 1.
- **ResumeReconciler constructor**: Added `state_manager: ApprovalStateManager` parameter, stored as `self._sm`
- **ResumeReconciler.reconcile()**: Replaced direct `lifecycle_state = RESUME_RECONCILED` with `self._sm.advance()`
- **`_try_enrich_phase1_entry` promoted to `InterruptCapture._try_enrich_phase1_entry()`**: Moved from standalone function to instance method, replacing both direct assignments with `self._sm.advance()`. Eliminates parameter threading and groups behavior with its owning class.

### Design decisions

- **Clear-signal sentinel stays as direct construction**: The `PendingApproval(tool_call_id="", lifecycle_state=CLEARED)` sentinel is a protocol marker, not a real lifecycle transition. Running `advance()` on it would log a misleading transition for a non-existent tool call.
- **advance() stays strict**: No idempotent mode added. The existing flow guarantees single-pass processing per PA via `matched_tc_ids` dedup in capture and single reconcile call on resume.

### execute_graphton.py — Injection site

- Added `ApprovalStateManager` to import, removed `_try_enrich_phase1_entry` (no longer module-level)
- `ResumeReconciler` instantiation now creates and passes `ApprovalStateManager`
- Removed backward-compat re-export comment block from the extraction refactor

### Tests — Updated + new enforcement tests

- `test_hitl_contracts.py`: Updated all `ResumeReconciler` tests to pass `state_manager`, refactored `TestInterruptCaptureContract` to use `InterruptCapture._try_enrich_phase1_entry()`, added `TestAdvanceEnforcement` class with spy-based verification that `advance()` is called and backward transitions are rejected
- `test_approval_resume.py`: Replaced standalone function import with `InterruptCapture` adapter, set proper `lifecycle_state` on MagicMock PAs
- `test_status_builder.py`: Replaced inline imports with `InterruptCapture._make_capture()` helper

## Benefits

- **Forward-only invariant enforced everywhere**: Any backward lifecycle transition now raises `ValueError` immediately instead of silently corrupting state
- **Structured audit trail**: Every lifecycle transition emits a `[LIFECYCLE]` log with execution_id, tool_call_id, tool_name, from/to states, and service name
- **Cleaner architecture**: `_try_enrich_phase1_entry` is no longer a standalone function floating outside its owning class — it's an `InterruptCapture` method with natural access to dependencies
- **Eliminated backward-compat debt**: Removed the temporary re-export from `execute_graphton.py` that was a leftover from the module extraction

## Impact

- **Python agent-runner only** — No proto changes, no Go/Java changes, no frontend changes
- **All lifecycle transitions** in `InterruptCapture` and `ResumeReconciler` now go through the centralized state manager
- **Test coverage** includes spy-based enforcement tests that verify `advance()` is actually called, not bypassed

## Related Work

- Parent project: `20260326.02.hitl-approval-flow-hardening` (Task 1 of 6)
- Predecessor: `2026-03-26-201753-hitl-approval-flow-hardening.md` — introduced `ApprovalLifecycleState` proto enum and `ApprovalStateManager` class
- Predecessor: `2026-03-26-204832-modularize-execute-graphton-activity.md` — extracted `hitl.py` from `execute_graphton.py`

---

**Status**: Production Ready
