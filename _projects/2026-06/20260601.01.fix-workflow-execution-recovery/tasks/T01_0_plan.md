# Task Plan: Fix Workflow Execution Recovery

**Created**: 2026-06-01
**Status**: Pending Review
**Timeline**: 1 week

## Problem Statement

When a user clicks "Recover" on a failed workflow execution:
1. Phase transitions to IN_PROGRESS (Recover RPC succeeds)
2. But no task progress is visible (event pipeline broken)
3. All tasks re-run from scratch instead of skipping completed ones (wrong semantics)
4. Cursor agent resume fails silently (error misclassification)

Recovery should mean: **continue from where it failed, preserve completed work.**

## Root Causes (Confirmed via Code Analysis)

| # | Root Cause | Impact | Severity |
|---|-----------|--------|----------|
| RC1 | TS runner resets event sequence to 1 on each engine start; MongoDB drops duplicates silently | New-run events never persisted or displayed | Critical |
| RC2 | No task-level resume — engine always starts from task 0 | Completed work re-executed wastefully | Critical |
| RC3 | Bare "Cursor run failed" on resumed handle classified as `unknown` (not `agent-stale`) | Poisoned-handle recovery never fires | High |
| RC4 | React event store not reset on FAILED→IN_PROGRESS transition | Even valid events filtered out | High |
| RC5 | Only Java parent terminated; TS child `workflow-exec-{id}` left as zombie | Potential conflict on new child start | Medium |
| RC6 | `status.tasks[]` not cleared on recovery | UI shows stale failed-task indicators | Low |

## Task Breakdown

### T01: Event Sequence Continuation (TS Runner)
**Repo:** stigmer | **Effort:** Small | **Parallel:** Independent

Fix the TS runner to continue event sequence from the persisted high-water mark instead of resetting to 1.

**Files:**
- `backend/services/runner/src/activities/workflow-event-activities.ts` — replace `resetSequenceCounter()` with `initSequenceFromEventLog(executionId)`
- `backend/services/runner/src/workflows/engine-core.ts` — replace `ResetEventSequence()` call

**Acceptance:**
- First execution: sequence starts at 1 (no change)
- Recovery: sequence continues from last persisted event (e.g., N+1)
- MongoDB stores new events (no duplicate key skip)
- `getEventLog` returns both old and new events in order

---

### T02: Task-Level Resume in TS Engine (Core Change)
**Repo:** stigmer | **Effort:** Large | **Parallel:** Depends on T01

Implement "recovery mode" in the TS workflow engine: read completed task outputs from event log, pre-populate `$context`, skip completed tasks, resume from the first incomplete/failed task.

**Files:**
- `backend/services/runner/src/workflow-engine/do-executor.ts` — add recovery context loading and task skip logic
- `backend/services/runner/src/workflows/engine-core.ts` — pass recovery flag to engine
- `backend/services/runner/src/workflows/execute-from-execution.ts` — read recovery flag from workflow input

**Design:**
- On engine start with `recoveryMode: true`: call `getEventLog`, extract `task_completed` outputs, populate `$context`
- For each task: if output already in recovery context → emit `task_skipped` event, continue
- First task NOT in recovery context → execute normally
- Downstream tasks execute normally with recovered `$context`

**New event type:** `task_skipped` (add to proto if not present)

**Acceptance:**
- Multi-task workflow: tasks 1,2 complete, task 3 fails → recover → tasks 1,2 skipped, task 3 re-executes
- `$context` in task 3 has outputs from tasks 1 and 2
- `task_skipped` events emitted for completed tasks
- Non-recovery executions are unaffected (no flag = no recovery mode)

---

### T03: Recovery Flag Propagation (Java + Go Handlers)
**Repo:** stigmer-cloud + stigmer | **Effort:** Small | **Parallel:** Can start with T02

Pass a `recoveryMode: true` marker from the RecoverHandler to the new Temporal orchestrator workflow, which passes it to the TS child.

**Files (Cloud):**
- `WorkflowExecutionRecoverHandler.java` — set recovery flag in workflow input
- `InvokeWorkflowExecutionWorkflowCreator.java` — accept and forward flag
- `InvokeWorkflowExecutionWorkflowImpl.java` — pass flag to TS child as workflow input

**Files (OSS):**
- `backend/services/stigmer-server/.../workflowexecution/controller/recover.go` — set flag
- `backend/services/stigmer-server/.../workflowexecution/temporal/workflows/workflow_creator.go` — forward flag
- `backend/services/stigmer-server/.../workflowexecution/temporal/workflows/invoke_workflow_impl.go` — pass to child

**Acceptance:**
- Normal create: no flag → engine starts fresh
- Recover: flag present → engine enters recovery mode (reads event log, skips completed tasks)

---

### T04: Fix Cursor Error Classification + Poisoned-Handle Persistence
**Repo:** stigmer | **Effort:** Medium | **Parallel:** Independent (can do alongside T01-T03)

Fix two bugs in execute-cursor:
1. Bare "Cursor run failed" on a resumed handle should classify as `agent-stale` (not `unknown`)
2. Poisoned-handle recovery should ALWAYS persist the fresh agentId to the session

**Files:**
- `backend/services/runner/src/activities/execute-cursor/error-classifier.ts` — fix fallback for resumed handles
- `backend/services/runner/src/activities/execute-cursor/index.ts` — fix session update condition in poisoned-handle recovery

**Acceptance:**
- Resumed handle + bare SDK error → classified `agent-stale` → `shouldRetryWithFreshAgent` returns true
- After poisoned-handle recovery: session's `harness_state_id` = new agent ID (not old poisoned one)
- Non-resumed errors: no behavior change

---

### T05: React Event Store Reset on Recovery
**Repo:** stigmer | **Effort:** Small | **Parallel:** Independent (can do alongside T01-T04)

Reset the event store and resubscribe from sequence 0 when execution phase transitions from terminal (FAILED) to active (IN_PROGRESS).

**Files:**
- `sdk/react/src/workflow/useWorkflowExecutionEventStream.ts` — detect terminal→active transition, reset store

**Acceptance:**
- User watches failed execution → clicks Recover → timeline clears and shows fresh events from new run
- Normal execution (no recovery): no store reset occurs
- `task_skipped` events rendered distinctly (greyed out or similar indicator)

---

### T06: Temporal Cleanup + Status Reset (Java + Go Handlers)
**Repo:** stigmer-cloud + stigmer | **Effort:** Small | **Parallel:** Independent

1. Terminate TS child workflow `workflow-exec-{id}` during recovery (alongside parent)
2. Clear `status.tasks[]` in execution document on recovery

**Files (Cloud):**
- `WorkflowExecutionRecoverHandler.java` — terminate child, clear tasks in UpdatePhaseStep

**Files (OSS):**
- `backend/services/stigmer-server/.../workflowexecution/controller/lifecycle_steps.go` — terminate child step
- `backend/services/stigmer-server/.../workflowexecution/controller/recover.go` — add step to pipeline

**Acceptance:**
- No zombie TS child after recovery
- UI shows clean "IN_PROGRESS" state (no stale failed-task indicators) before new events arrive

---

### T07: Integration Tests
**Repo:** stigmer | **Effort:** Medium | **Parallel:** After T01-T03 merged

Write comprehensive integration tests for the recovery flow.

**Files:**
- `test/integration/workflow_execution_recover_task_resume_test.go` — new test file

**Tests:**
1. `TestWorkflowExecution_Recover_SkipsCompletedTasks` — multi-task workflow (set_vars → set_vars → raise_error), recover, assert tasks 1+2 skipped with outputs preserved in context
2. `TestWorkflowExecution_Recover_AgentCallCursor` — agent_call fails, recover, verify Cursor resume attempted, harness_state_id preserved, workflow reaches terminal
3. `TestWorkflowExecution_Recover_EventSequenceContinuation` — verify post-recovery events have seq > pre-recover high-water
4. `TestWorkflowExecution_Recover_ChildTerminated` — verify no zombie child after recovery

**Acceptance:**
- All tests pass against local Java service
- Tests use existing harness patterns (TemporalInspector, EventCollector, ExecutionWaiter)

---

### T08: Proto + Documentation Fixes
**Repo:** stigmer | **Effort:** Small | **Parallel:** After T02 merged

Fix stale documentation that incorrectly describes recovery semantics.

**Files:**
- `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto` — fix `RecoverWorkflowExecutionInput` comment
- `apis/ai/stigmer/agentic/workflowexecution/v1/command.proto` — update recover RPC docs
- `sdk/react/src/workflow/useWorkflowExecutionActions.ts` — fix JSDoc
- `apis/ai/stigmer/agentic/workflowexecution/v1/event.proto` — add `task_skipped` if needed

**Acceptance:**
- Proto docs accurately describe: "skip completed tasks, resume from failed task"
- JSDoc matches actual behavior
- `buf lint` passes

---

### T09: Manual Verification
**Effort:** Small | **Parallel:** After all code deployed locally

Reset the stuck production execution in MongoDB and manually test recovery via the desktop app UI.

**Steps:**
1. Reset execution phase to FAILED in production MongoDB
2. Click Recover in the UI
3. Verify: completed tasks show as skipped, failed task re-executes
4. Verify: events stream live in the waterfall timeline
5. Verify: Cursor agent resumes or gracefully falls back

---

## Parallelism Map

```
Week 1:
┌─────────────────────────────────────────────────────────────────┐
│ Day 1-2:                                                         │
│   T01 (sequence)  ─┐                                             │
│   T04 (error cls)  │  ← all independent, can run in parallel    │
│   T05 (react)      │                                             │
│   T06 (cleanup)   ─┘                                             │
├─────────────────────────────────────────────────────────────────┤
│ Day 2-4:                                                         │
│   T02 (task resume) ← core change, depends on T01 for events    │
│   T03 (flag)        ← small, can start day 2, finishes quick    │
├─────────────────────────────────────────────────────────────────┤
│ Day 4-5:                                                         │
│   T07 (integration tests) ← after T01-T03 merged                │
│   T08 (proto docs)        ← after T02 merged                    │
├─────────────────────────────────────────────────────────────────┤
│ Day 5:                                                           │
│   T09 (manual verification) ← final validation                  │
└─────────────────────────────────────────────────────────────────┘
```

**Batch 1 (parallel, no dependencies):** T01, T04, T05, T06
**Batch 2 (sequential core change):** T02 (depends on T01), T03 (small, enables T02)
**Batch 3 (validation):** T07, T08, T09

## Key Design Decisions

1. **Recovery flag (explicit) over event-log detection (implicit):** The engine uses an explicit `recoveryMode` flag passed from RecoverHandler. This avoids false positives from crash restarts or YAML try/catch retries within a single run.

2. **Keep `harness_state_id` (don't clear):** Gives Cursor SDK a chance to genuinely resume the agent. If dead, the existing graceful fallback (resolveAgent) handles it. Session memory provides context regardless.

3. **Sequence continuation (not log reset):** Runner queries `getEventLog` for the high-water mark and continues numbering. This is additive — old events from the failed run remain in the log alongside new recovery events. The UI event store resets on the FAILED→IN_PROGRESS transition so it replays the full history cleanly.

4. **`task_skipped` as a new event type:** The UI needs to distinguish "this task completed previously and was skipped on recovery" from "this task hasn't run yet." A dedicated event type makes this explicit.
