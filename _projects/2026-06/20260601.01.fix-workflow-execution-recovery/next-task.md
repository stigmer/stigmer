# Next Task: 20260601.01.fix-workflow-execution-recovery

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260601.01.fix-workflow-execution-recovery

**Description**: Fix the workflow execution recovery flow so that clicking Recover on a failed workflow properly resumes execution from the failed task, preserving completed work and continuing from the failure point.
**Goal**: Implement proper task-level resume on recovery: skip completed tasks (using persisted outputs from event log), resume from the failed task, fix the event pipeline sequence collision so progress is visible, and fix Cursor agent resume error classification.
**Tech Stack**: TypeScript (TS runner/workflow engine), Java (stigmer-cloud service), Go (stigmer-server OSS), React (SDK event stream hooks)
**Components**: TS workflow runner (do-executor, workflow-event-activities, engine-core, execute-cursor), Java cloud service (WorkflowExecutionRecoverHandler), Go OSS service (recover.go, lifecycle_steps.go), React SDK (useWorkflowExecutionEventStream), Integration tests

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-06/20260601.01.fix-workflow-execution-recovery/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-06-01 14:37
**Current Task**: T02 complete. Next: pick from T03, T04, T05, T06.
**Status**: T01 and T02 implemented and committed. Plan approved and in progress.
**Last Session**: 2026-06-01 — T02 (Task-Level Resume) completed.

## Session Progress (2026-06-01, Session 2)

### T02 Completed: Task-Level Resume in TS Engine
- Created `recovery.ts` — `RecoveryContext` type, `RecoveryTaskData` serialization type, `buildRecoveryContext` builder (sandbox-safe)
- Added `LoadRecoveryContext` activity — fetches execution status.tasks[], converts proto to plain objects for Temporal serialization boundary
- Wired `recovery_mode` through `ExecuteFromExecutionInput` → `RunWorkflowEngineOptions` → `engine-core.ts`
- Implemented skip logic in `do-executor.ts` — skips completed tasks, restores $context/$output via processTaskOutput/processTaskExport, emits task_skipped events, respects flow directives
- Recovery context deactivated after first non-skipped task to prevent accidental late skipping
- 23 new unit tests (8 recovery builder + 15 do-executor recovery), all 1370 runner tests pass

### Critical Discoveries During T02
- **task_completed events don't carry output** — output_summary field exists in proto but is never populated. Recovery reads from status.tasks[].output instead (64KB truncation limit, acceptable for >99% of workflows)
- **T06 data race** — if T06 clears status.tasks[] before engine reads it, recovery data is lost. Recommendation: T06 should NOT clear status.tasks[] (engine's event emission naturally replaces stale entries)
- **Version pinning safety** — hydration uses workflowVersionHash, guaranteeing identical YAML between failed and recovery runs

### Files Created
- `backend/services/runner/src/workflow-engine/recovery.ts`
- `backend/services/runner/src/workflow-engine/__tests__/recovery.test.ts`
- `backend/services/runner/src/workflow-engine/__tests__/do-executor-recovery.test.ts`

### Files Modified
- `backend/services/runner/src/activities/workflow-event-activities.ts`
- `backend/services/runner/src/activities/__tests__/workflow-event-activities.test.ts`
- `backend/services/runner/src/workflows/execute-from-execution.ts`
- `backend/services/runner/src/workflows/engine-core.ts`
- `backend/services/runner/src/workflow-engine/do-executor.ts`

### T01 Completed (Session 1): Event Sequence Continuation (TS Runner)
- Replaced blind `resetSequenceCounter()` with `initSequenceFromEventLog(executionId)` that queries `getEventLog` for the persisted high-water mark
- Committed: `dd1a4e8cb fix(backend/runner): continue event sequence from high-water mark on recovery`

## Next Steps

Pick the next task:

1. **T03** (Small) — Recovery Flag Propagation (Java + Go) — wires recovery_mode from RecoverHandler to TS child. **Enables T02 at runtime.**
2. **T04** (Medium) — Fix Cursor Error Classification + Poisoned-Handle Persistence
3. **T05** (Small) — React Event Store Reset on FAILED→IN_PROGRESS transition
4. **T06** (Small) — Temporal Cleanup + Status Reset (Java + Go) — **must NOT clear status.tasks[]** per T02 findings

**Recommendation**: T03 next — it's small and activates the entire T01+T02 recovery chain end-to-end.

## Task Summary (9 tasks, ~1 week)

| Task | Description | Effort | Status |
|------|-------------|--------|--------|
| T01 | Event Sequence Continuation (TS Runner) | Small | **Done** ✅ |
| T02 | Task-Level Resume in TS Engine | Large | **Done** ✅ |
| T03 | Recovery Flag Propagation (Java + Go) | Small | Ready |
| T04 | Fix Cursor Error Classification | Medium | Ready |
| T05 | React Event Store Reset | Small | Ready |
| T06 | Temporal Cleanup + Status Reset | Small | Ready (revised: don't clear status.tasks[]) |
| T07 | Integration Tests | Medium | Blocked (needs T03) |
| T08 | Proto + Documentation | Small | Ready (T02 done) |
| T09 | Manual Verification (MongoDB reset) | Small | Blocked (needs all code) |

**Batch 1 (days 1-2):** ~~T01~~, T04, T05, T06
**Sequential core (days 2-4):** ~~T02~~, T03
**Validation (days 4-5):** T07, T08, T09

## Quick Commands

After loading context:
- "What to pick next?" - Get recommendation on next task
- "Continue with T04" - Start Cursor error classification fix
- "Continue with T02" - Start the core task-level resume work
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
