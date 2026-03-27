# Next Task: 20260326.02.hitl-approval-flow-hardening

## Current State
- **Status**: in-progress (3 of 6 tasks complete)
- **Last Session**: 2026-03-27 — Completed Task 5 (dead code cleanup + batch resume visibility)
- **Active Task**: None — ready to pick next task
- **Branch**: `hitl-flow-hardening` (pushed to origin)

## Session Progress (2026-03-27, Session 3)

### Completed
- **Task 5**: Remove dead `_remove_from_pending` and improve batch resume visibility
  - Deleted `_remove_from_pending` method (32 lines, zero production callers) from `status_builder.py`
  - Updated "Approval State Management" section comment to reference `ResumeReconciler` clear-signal pattern
  - Deleted `test_remove_from_pending_resolves_run_id_aliases` test from `test_status_builder.py`
  - Added `MESSAGE_SYSTEM` to execution message stream when batch resume aborts (`loop_aborted = True`)
  - All 278 status builder tests pass (down 1 from deleted test), all 22 HITL contract tests pass

### Key Decisions
- Chose deletion over `@deprecated` — zero production callers on a private method means deprecation annotation is noise
- The abort message follows the established `AgentMessage(type=MESSAGE_SYSTEM)` pattern used elsewhere in `execute_graphton.py`

## Cumulative Progress (Sessions 1-3)
- **Task 1** ✅: ApprovalStateManager lifecycle enforcement (4 bypass sites fixed, spy-based tests added)
- **Task 2** ✅: Sub-agent fingerprint map population (2-line fix, 3 contract tests added)
- **Task 5** ✅: Dead code cleanup + batch resume visibility (method + test removed, user-visible abort message added)

## Next Steps
1. **Task 3**: Convert single-shot poll fallback to repeating poll with exponential backoff in `useSessionConversation.ts`
2. **Task 4**: Add staleness detection after optimistic dismissal in `useSessionConversation.ts`
3. **Task 6**: Validation — contract tests + manual E2E

### Recommended Next Pick
Tasks 3 and 4 are both React/SDK work in `useSessionConversation.ts` — they should be batched together in a single session. Task 6 (validation) comes last after all code changes land.

## Context for Resume
- All Python backend work is now complete (Tasks 1, 2, 5)
- Remaining work is React/SDK frontend resilience in `useSessionConversation.ts` (Tasks 3, 4) and validation (Task 6)
- Tasks 3 and 4 both touch the streaming/polling layer — the `useEffect` that watches `activePhase` and `pendingApprovals`
- Task 6 (validation) should be done last after all code changes land
- Six state representations exist for approval status (see `notes.md`) — this is the root cause of most HITL bugs

## Blockers
None.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260326.02.hitl-approval-flow-hardening/next-task.md`

---

## Project Overview

**Name**: 20260326.02.hitl-approval-flow-hardening
**Goal**: Fix structural gaps in the HITL approval flow -- enforce lifecycle state machine, fix sub-agent fingerprints, harden frontend resilience.
**Tech Stack**: Python (agent-runner), TypeScript/React (SDK + web), Go (stigmer-server), Proto/Buf

**Created**: 2026-03-26
**Type**: Quick Project (2 sessions)

## Project Files

```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.02.hitl-approval-flow-hardening/tasks.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.02.hitl-approval-flow-hardening/README.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.02.hitl-approval-flow-hardening/notes.md
```

## Key Source Files

**Python (agent-runner):**
```
backend/services/agent-runner/worker/activities/graphton/hitl.py
backend/services/agent-runner/worker/activities/graphton/status_builder.py
backend/services/agent-runner/worker/activities/execute_graphton.py
```

**React (SDK):**
```
sdk/react/src/session/useSessionConversation.ts
sdk/react/src/execution/ApprovalCard.tsx
```

**Tests:**
```
backend/services/agent-runner/tests/test_hitl_contracts.py
backend/services/agent-runner/tests/test_status_builder.py
backend/services/agent-runner/tests/test_approval_resume.py
```

## Architecture Quick Reference

```
Lifecycle: REQUESTED -> INTERRUPT_CAPTURED -> DECISION_RECORDED -> RESUME_RECONCILED -> CLEARED
             Python        Python              Go/Java              Python              Python

Flow: Python(approve?) -> DB(pending_approvals) -> Temporal(wait) -> User(approve) ->
      Go/Java(record+signal) -> Temporal(re-invoke) -> Python(resume+reconcile) -> LangGraph(resume)
```

---

*Quick Project Framework: Read tasks.md, continue where you left off.*
