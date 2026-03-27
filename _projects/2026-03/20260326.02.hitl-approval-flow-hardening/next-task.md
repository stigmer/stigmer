# Next Task: 20260326.02.hitl-approval-flow-hardening

## Current State
- **Status**: in-progress (5 of 6 tasks complete)
- **Last Session**: 2026-03-27 — Completed Tasks 3 + 4 (frontend resilience in useSessionConversation.ts)
- **Active Task**: None — ready to pick next task
- **Branch**: `hitl-flow-hardening` (pushed to origin)

## Session Progress (2026-03-27, Session 4)

### Completed
- **Task 3**: Exponential backoff polling for missing approval data
  - Replaced single-shot `setTimeout(3s)` with self-scheduling timeout chain (3s, 6s, 12s, 24s, 30s cap)
  - Changed poll condition from filtered `pendingApprovals.length` to raw `activeStreamExecution?.status?.pendingApprovals?.length` — separates "server didn't deliver data" (Task 3) from "user dismissed but signal failed" (Task 4)
  - Added 5 tests: backoff schedule, stops on data arrival, stops on phase change, skips when raw approvals exist but dismissed, cleanup on unmount
  - Decided against adding a visible "loading" indicator — consumer can derive the state trivially

- **Task 4**: Staleness detection for optimistic dismissals
  - Changed internal `dismissedApprovalIds` from `Set<string>` to `Map<string, number>` (toolCallId → timestamp)
  - Derived `ReadonlySet<string>` via `useMemo` for the public API — zero breaking changes for platform builders
  - Added staleness `useEffect` with `setInterval(5s)` that detects entries older than 15s and removes them (card reappears)
  - Used `useRef` for latest-map sync pattern to avoid stale closures in interval callbacks
  - Triggers `refetch()` when stale entries are detected to get fresh server state
  - Added 5 tests: card reappearance, no check outside WAITING_FOR_APPROVAL, refetch on staleness, ReadonlySet type contract, reset on new execution
  - All 95 SDK React tests pass (20 in useSessionConversation, up from 10)

### Key Decisions
- **Raw vs. filtered poll condition**: Task 3 polls when server genuinely hasn't delivered data (raw count = 0). Task 4 handles the dismissed-but-stuck case. Clean separation avoids wasteful network requests.
- **Internal Map, public Set**: The Map with timestamps is an implementation detail. Platform builders see `ReadonlySet<string>` unchanged. MessageThread and all downstream consumers work without modification.
- **No public API additions**: Both tasks are internal behavior improvements. No new fields on `UseSessionConversationReturn`. Consumers who need "loading approval details" state can derive it from `activePhase + pendingApprovals.length`.
- **Strict greater-than threshold**: `now - ts > 15000` (not `>=`). First stale detection occurs at the 20s interval tick, not 15s. This avoids false positives from timing precision.

## Cumulative Progress (Sessions 1-4)
- **Task 1** ✅: ApprovalStateManager lifecycle enforcement (4 bypass sites fixed, spy-based tests added)
- **Task 2** ✅: Sub-agent fingerprint map population (2-line fix, 3 contract tests added)
- **Task 3** ✅: Exponential backoff polling (self-scheduling timeout chain, raw approval condition)
- **Task 4** ✅: Staleness detection (internal Map with timestamps, 15s threshold, card reappearance)
- **Task 5** ✅: Dead code cleanup + batch resume visibility (method + test removed, user-visible abort message added)

## Next Steps
1. **Task 6**: Validation — contract tests + manual E2E

### Recommended Next Pick
Task 6 (validation) is the only remaining task. All code changes have landed.

## Context for Resume
- All Python backend work is complete (Tasks 1, 2, 5)
- All React/SDK frontend work is complete (Tasks 3, 4)
- Only validation (Task 6) remains — contract tests + manual E2E
- All 95 SDK React tests pass, all 278 status builder tests pass, all 22 HITL contract tests pass
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
