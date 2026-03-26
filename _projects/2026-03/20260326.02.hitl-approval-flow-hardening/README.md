# 20260326.02.hitl-approval-flow-hardening

## Overview

Fix structural gaps in the Human-in-the-Loop (HITL) approval flow identified through analysis of four cascading bugs on March 26. The HITL flow spans Python (agent-runner), Go/Java (approval handlers), Temporal (workflow orchestration), and React (frontend). This project enforces the lifecycle state machine, fixes sub-agent fingerprint matching, and hardens frontend resilience.

**Created**: 2026-03-26
**Estimated Time**: 2-4 hours across 2 sessions
**Status**: 🚧 In Progress

## Goal

Close the gaps identified in the HITL gap analysis (prioritized):

**Phase 1 (Correctness):** Enforce ApprovalStateManager on hot paths; populate sub-agent fingerprints.
**Phase 2 (Resilience):** Convert poll fallback to repeating; add staleness detection for optimistic dismissal.
**Phase 3 (Hygiene):** Remove dead code; improve batch resume visibility.
**Phase 4 (Validation):** Contract tests for all changes.

## Technology Stack

- **Python** (agent-runner): `graphton/hitl.py`, `graphton/status_builder.py`, `execute_graphton.py`
- **TypeScript/React** (SDK + web): `sdk/react/src/session/useSessionConversation.ts`, `sdk/react/src/execution/ApprovalCard.tsx`
- **Go** (stigmer-server): `backend/services/stigmer-server/pkg/domain/agentexecution/controller/submit_approval.go`
- **Proto/Buf**: `apis/ai/stigmer/agentic/agentexecution/v1/approval.proto`

## Affected Components (Absolute Paths)

**Python agent-runner:**
- `backend/services/agent-runner/worker/activities/graphton/hitl.py` (791 lines) -- ApprovalStateManager, InterruptCapture, ResumeReconciler, CheckpointFallback
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` -- _fingerprint_to_tool_call_id, _populate_pending_approval, _remove_from_pending
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (1983 lines) -- resume dict construction, RESUME_RECONCILE orchestration

**React SDK:**
- `sdk/react/src/session/useSessionConversation.ts` -- poll fallback, optimistic dismissal, submitApproval
- `sdk/react/src/execution/ApprovalCard.tsx` -- approval UI component

**Tests:**
- `backend/services/agent-runner/tests/test_hitl_contracts.py` -- Python contract tests
- `backend/services/agent-runner/tests/test_status_builder.py` -- StatusBuilder tests
- `test/e2e/hitl_approval_*.go` -- 6 E2E test files

## Success Criteria

- All lifecycle mutations in `InterruptCapture`, `ResumeReconciler`, `_try_enrich_phase1_entry` go through `ApprovalStateManager.advance()`
- Sub-agent tool calls have fingerprints in `_fingerprint_to_tool_call_id`
- Poll fallback retries with backoff until approvals appear or phase changes
- Optimistic dismissal reappears cards after 15s staleness
- `_remove_from_pending` removed or deprecated
- All existing tests pass; new contract tests for each fix

## Architecture Reference

```
Approval Lifecycle State Machine (Proto):
UNSPECIFIED -> REQUESTED -> INTERRUPT_CAPTURED -> DECISION_RECORDED -> RESUME_RECONCILED -> CLEARED
   (legacy)    (Python)        (Python)          (Go/Java)             (Python)           (Python)

End-to-End Flow:
1. Python sets WAITING_FOR_APPROVAL + pending_approvals (REQUESTED)
2. Python INTERRUPT_CAPTURE enriches with interrupt_ids (INTERRUPT_CAPTURED)
3. Python UpdateStatus -> DB
4. Activity returns slim status to Temporal workflow
5. Workflow blocks on submitApproval signal
6. User submits via UI -> Go/Java handler records decision (DECISION_RECORDED)
7. Handler signals Temporal workflow
8. Workflow re-invokes ExecuteGraphton with ApprovalDecisionList
9. Python reads pending_approvals from DB, builds resume dict
10. Python RESUME_RECONCILE transitions tool calls (RESUME_RECONCILED)
11. Python clears pending_approvals with sentinel (CLEARED)
12. LangGraph resumes with Command(resume={interrupt_id: decision})
```

## Quick Links

- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Related Changelogs

- `_changelog/2026-03/2026-03-26-174359-fix-hitl-approval-stale-idempotency-short-circuit.md`
- `_changelog/2026-03/2026-03-26-182903-fix-hitl-approval-matching-reconciliation-ui.md`
- `_changelog/2026-03/2026-03-26-193343-fix-hitl-resume-race-condition.md`
- `_changelog/2026-03/2026-03-26-194430-fix-hitl-resume-reconcile-argument-order.md`
- `_changelog/2026-03/2026-03-26-201753-hitl-approval-flow-hardening.md`

## Project Type

Quick Project - Designed to complete in 2 sessions with minimal overhead.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

- Current phase: Analysis complete, ready for implementation
- Blockers: None
- Next up: Task 1 -- ApprovalStateManager enforcement

---

*This project follows the Next Quick Project Framework for fast, focused development.*

