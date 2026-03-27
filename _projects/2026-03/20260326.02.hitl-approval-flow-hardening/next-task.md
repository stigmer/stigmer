# Next Task: 20260326.02.hitl-approval-flow-hardening

## Current State
- **Status**: in-progress (1 of 6 tasks complete)
- **Last Session**: 2026-03-26 — Completed Task 1 (ApprovalStateManager enforcement)
- **Active Task**: None — ready to pick next task
- **Branch**: `hitl-flow-hardening` (pushed to origin)

## Session Progress (2026-03-26)

### Completed
- **Task 1**: Route all lifecycle mutations through `ApprovalStateManager.advance()`
  - Replaced 4 direct `lifecycle_state` assignment bypass sites with `advance()` calls
  - Promoted `_try_enrich_phase1_entry` from standalone function to `InterruptCapture` private method
  - Injected `ApprovalStateManager` into `ResumeReconciler` constructor
  - Updated `execute_graphton.py` imports and wiring
  - Refactored 3 test files (`test_hitl_contracts.py`, `test_approval_resume.py`, `test_status_builder.py`)
  - Added `TestAdvanceEnforcement` spy-based test class

### Key Decisions
- Clear-signal sentinel (`lifecycle_state=CLEARED`) stays as direct construction — it's a protocol marker, not a lifecycle event
- `_try_enrich_phase1_entry` promoted to method on `InterruptCapture` for DDD alignment
- Backward-compat re-export in `execute_graphton.py` removed (clean break)

## Next Steps
1. **Task 2**: Populate `_fingerprint_to_tool_call_id` for sub-agent tool calls in `status_builder.py`
2. **Task 3**: Convert single-shot poll fallback to repeating poll with exponential backoff in `useSessionConversation.ts`
3. **Task 4**: Add staleness detection after optimistic dismissal in `useSessionConversation.ts`
4. **Task 5**: Remove dead `_remove_from_pending` and improve batch resume visibility
5. **Task 6**: Validation — contract tests + manual E2E

### Recommended Next Pick
Task 2 (sub-agent fingerprints) is the highest-severity remaining backend task and has no frontend dependencies. Task 3 and 4 are React/SDK work that can be batched together.

## Context for Resume
- All Python agent-runner HITL lifecycle mutations now go through `ApprovalStateManager.advance()` — the forward-only invariant is enforced
- The `hitl.py` file is 816 lines; `execute_graphton.py` is 1983 lines; `status_builder.py` is large and contains fingerprint logic
- Six state representations exist for approval status (see `notes.md`) — this is the root cause of most HITL bugs
- `_fingerprint_to_tool_call_id` is populated for top-level tool calls but NOT for sub-agent tool calls

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
