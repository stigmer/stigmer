# Next Task: 20260326.02.hitl-approval-flow-hardening

## Quick Resume Instructions

**Drop this file into chat to resume. Read tasks.md first for current progress.**

---

## Project Overview

**Name**: 20260326.02.hitl-approval-flow-hardening
**Goal**: Fix structural gaps in the HITL approval flow -- enforce lifecycle state machine, fix sub-agent fingerprints, harden frontend resilience.
**Tech Stack**: Python (agent-runner), TypeScript/React (SDK + web), Go (stigmer-server), Proto/Buf

**Created**: 2026-03-26
**Type**: Quick Project (2 sessions)

---

## Project Files

```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.02.hitl-approval-flow-hardening/tasks.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.02.hitl-approval-flow-hardening/README.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.02.hitl-approval-flow-hardening/notes.md
```

## Key Source Files to Edit

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
```

## Resume Checklist

1. [ ] Read `tasks.md` -- check which task is IN PROGRESS
2. [ ] Read `notes.md` -- check for any decisions or gotchas
3. [ ] Continue with current task or start next TODO

---

## Task Summary (6 tasks)

1. **ApprovalStateManager enforcement** -- Route all lifecycle mutations through `advance()` in hitl.py
2. **Sub-agent fingerprint map** -- Populate `_fingerprint_to_tool_call_id` for sub-agent tool calls in status_builder.py
3. **Repeating poll fallback** -- Convert single-shot to exponential backoff in useSessionConversation.ts
4. **Staleness detection** -- Reappear dismissed approval cards after 15s timeout in useSessionConversation.ts
5. **Dead code cleanup** -- Remove `_remove_from_pending`, improve batch resume visibility
6. **Validation** -- Contract tests + manual E2E

## Architecture Quick Reference

```
Lifecycle: REQUESTED -> INTERRUPT_CAPTURED -> DECISION_RECORDED -> RESUME_RECONCILED -> CLEARED
             Python        Python              Go/Java              Python              Python

Flow: Python(approve?) -> DB(pending_approvals) -> Temporal(wait) -> User(approve) ->
      Go/Java(record+signal) -> Temporal(re-invoke) -> Python(resume+reconcile) -> LangGraph(resume)
```

---

*Quick Project Framework: Read tasks.md, continue where you left off.*

