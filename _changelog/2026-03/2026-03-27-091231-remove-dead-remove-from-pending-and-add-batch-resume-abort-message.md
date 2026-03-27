# Remove Dead `_remove_from_pending` and Add Batch Resume Abort Message

**Date**: March 27, 2026

## Summary

Removed the dead `_remove_from_pending` method from `StatusBuilder` and added a user-visible `MESSAGE_SYSTEM` when the batch resume abort path fires in `execute_graphton.py`. This is maintenance hygiene and observability work as part of the HITL approval flow hardening project (Task 5).

## Problem Statement

Two independent issues in the HITL approval flow:

### Pain Points

- `_remove_from_pending` in `StatusBuilder` had zero production callers — it was replaced by the `ResumeReconciler` clear-signal sentinel pattern but never cleaned up, leaving dead code that could confuse future maintainers
- When batch resume aborts (a `pending_approval` has no matching `approval_decision` by `tool_call_id`), the user sees nothing in their execution message stream — only `activity_logger.warning` fires, which is operator-only

## Solution

1. **Deleted dead code**: Removed the 32-line `_remove_from_pending` method, its test, and updated the section comment to accurately describe the remaining approval state management helpers
2. **Added user-visible abort message**: Appended a `MESSAGE_SYSTEM` to `status_builder.current_status.messages` when `loop_aborted = True`, following the established `AgentMessage` pattern used elsewhere in the file

## Implementation Details

### Dead Code Removal (`status_builder.py`)

- Deleted `_remove_from_pending` (lines 2276-2308) — the method handled per-tool removal from `_pending_tool_approvals`, resolving through `_run_id_aliases` for reconciliation-path tool calls
- Updated the "Approval State Management (HITL Phase 2)" section comment to reference `ResumeReconciler` for the resume path and clarify that the remaining helpers (`clear_pending_approval`, `sync_sub_agent_pending_approvals`) serve non-resume bookkeeping
- Deleted `test_remove_from_pending_resolves_run_id_aliases` from `test_status_builder.py` — the sole caller of the removed method

### Batch Resume Abort Message (`execute_graphton.py`)

- Added `AgentMessage(type=MESSAGE_SYSTEM)` immediately after `resume_dict = {}` on the `loop_aborted` path
- Message content: `"⚠️ Approval resume skipped: a pending approval (tool_call_id=...) had no matching decision. The agent will restart from its last checkpoint instead of resuming."`
- The message is pushed to the UI during the first `update_status` call in the streaming phase

### Decision: Deletion Over Deprecation

Chose clean deletion over `@deprecated` because:
- Zero production callers — the replacement (`ResumeReconciler.reconcile`) has been in place since Task 1 of this project
- Private method (`_remove_from_pending`) — deprecation annotations on private methods with no callers would never trigger a warning
- The clear-signal sentinel pattern is architecturally different, not a drop-in replacement, so a deprecation notice pointing to it would be misleading

## Benefits

- **Reduced cognitive load**: 32 lines of dead code removed from a critical file (`status_builder.py` at ~3400 lines), one fewer method for maintainers to understand
- **User visibility**: Batch resume abort is now surfaced in the execution message stream, giving users a clear explanation when the agent restarts from checkpoint instead of resuming
- **Accurate documentation**: Section comment now correctly describes the approval state management architecture

## Impact

- **StatusBuilder**: 278 tests pass (down from 279 — the deleted test)
- **HITL Contracts**: All 22 tests pass
- **Zero regressions**: No behavioral changes to the resume/abort flow — purely observability and hygiene
- **User experience**: Platform builders embedding execution viewers will now see the abort reason in their message stream

## Related Work

- Part of the HITL Approval Flow Hardening project (`20260326.02`)
- Task 1 (lifecycle enforcement) and Task 2 (sub-agent fingerprints) completed in prior sessions
- The `ResumeReconciler` clear-signal pattern that replaced `_remove_from_pending` was formalized in Task 1

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~15 minutes)
