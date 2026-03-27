# Next Task: 20260326.02.hitl-approval-flow-hardening

## Current State
- **Status**: in-progress (2 of 6 tasks complete)
- **Last Session**: 2026-03-27 — Completed Task 2 (sub-agent fingerprint map population)
- **Active Task**: None — ready to pick next task
- **Branch**: `hitl-flow-hardening` (pushed to origin)

## Session Progress (2026-03-27)

### Completed
- **Task 2**: Populate `_fingerprint_to_tool_call_id` for sub-agent tool calls
  - Added 2 lines in `populate_fingerprints_from_existing_tool_calls()` to populate `_fingerprint_to_tool_call_id` for sub-agent tool calls (mirroring the existing top-level behavior)
  - Added Contract 7 (`TestSubAgentFingerprintMapPopulation`) with 3 tests in `test_hitl_contracts.py`
  - All 22 HITL contract tests pass, all 279 status builder tests pass

### Key Findings
- The bug was specifically in `populate_fingerprints_from_existing_tool_calls()`, not in `_handle_tool_start_event` — the task description had a minor reference error but the line numbers were correct
- No changes needed in `_handle_tool_start_event` — the dedup + alias logic works correctly once the map is pre-populated

## Cumulative Progress (Sessions 1-2)
- **Task 1** ✅: ApprovalStateManager lifecycle enforcement (4 bypass sites fixed, spy-based tests added)
- **Task 2** ✅: Sub-agent fingerprint map population (2-line fix, 3 contract tests added)

## Next Steps
1. **Task 5**: Remove dead `_remove_from_pending` and improve batch resume visibility (quick Python cleanup — do before frontend work)
2. **Task 3**: Convert single-shot poll fallback to repeating poll with exponential backoff in `useSessionConversation.ts`
3. **Task 4**: Add staleness detection after optimistic dismissal in `useSessionConversation.ts`
4. **Task 6**: Validation — contract tests + manual E2E

### Recommended Next Pick
Task 5 (dead code cleanup) is a quick win while still in the Python backend. Tasks 3+4 are React/SDK work that should be batched together in a single session.

## Context for Resume
- Tasks 1 and 2 addressed Python backend correctness gaps in the HITL lifecycle
- The remaining Python work (Task 5) is maintenance hygiene — low risk, quick execution
- Tasks 3 and 4 are React/SDK frontend resilience work in `useSessionConversation.ts` — these touch the streaming/polling layer
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
