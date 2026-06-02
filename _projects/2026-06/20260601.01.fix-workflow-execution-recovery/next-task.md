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
**Current Task**: T07 complete. Only T09 (Manual Verification) remains.
**Status**: T01–T08 implemented and tested. One validation task remains (T09).
**Last Session**: 2026-06-01 — T07 (Integration Tests) completed.

## Session Progress (2026-06-01, Session 8)

### T07 Completed: Recovery Task-Resume Integration Tests
- Created `test/integration/workflow_execution_recover_task_resume_test.go` — 3 new integration tests
- `TestRecover_SkipsCompletedTasks` (1.4s): verifies WORKFLOW_TASK_SKIPPED status, task_skipped events with recovery reason, Temporal child/orchestrator terminal
- `TestRecover_EventSequenceContinuation` (1.2s): verifies post-recovery events have seq > pre-recovery high-water mark, monotonically increasing, no duplicates
- `TestRecover_AgentCallTaskSkip` (14.3s): verifies agent_call tasks correctly handled through skip path (requires CURSOR_API_KEY)
- All 3 tests pass against full service stack (Temporal + Java service + TS runner + Mongo + Redis + OpenFGA)
- Validation: `go vet` clean, `gofmt` clean, `go build` clean

## Session Progress (2026-06-01, Session 7)

### T08 Completed: Proto + Documentation Fixes
- Fixed contradictory recovery docs in io.proto (was: "checkpoint/reset" — never implemented)
- Rewrote 89-line recover RPC doc block in command.proto: corrected summary, behavior steps, state transitions table, and Recovery vs Restart comparison
- Broadened event.proto TaskSkippedPayload and enum comment to cover recovery as second skip scenario
- Replaced one-liner SDK JSDoc with multi-line doc describing task-level resume and @param reason
- Validation: `buf lint` clean, `tsc --noEmit` clean, `npm run lint` 0 errors

## Session Progress (2026-06-01, Session 6)

### T04 Completed: Fix Cursor Error Classification + Poisoned-Handle Persistence
- Refactored `synthesizeError` into two stages: `classifyFromSources` (unchanged cascade) + post-classification resumed-handle override
- Override upgrades `unknown` to `agent-stale` when `isResumedHandle` is true — specific diagnoses (auth, rate-limit, network, model) are never overridden
- Extracted `SynthesizeErrorOpts` interface for the shared parameter type
- Updated module-level and function-level JSDoc to document the two-step classification model
- Removed faulty `if (resolution.isNew || !blueprint.sessionSpec.harnessStateId)` guard from poisoned-handle recovery session persistence — fresh agentId is now always persisted
- Extended test suite from 9 to 24 tests: bug-fix case, all source branches, resumed-handle override, source priority, complete `shouldRetryWithFreshAgent` coverage
- All 24 tests pass, zero lint errors
- Committed: `a38509ca3`

### Design Decisions
- **Extract-and-override over inline fix**: Matches existing helper extraction pattern (`matchesAny`, `classifyText`). The override is a principled statement about execution context, not a branch-specific patch.
- **Override scoped to `unknown` only**: Specific diagnoses are real root causes. Only `unknown` (no source could identify the error) gets the stale-handle heuristic.
- **Unconditional persistence over corrected conditional**: `resolution` is `const` and reflects pre-recovery state. Removing the guard is simpler and more correct than deriving a corrected check.

### Observation (out of scope)
- `MODEL_PATTERNS` contains `"model.*not available"` treated as literal substring by `matchesAny` (uses `includes()`, not regex). Pre-existing issue — should be addressed separately.

## Session Progress (2026-06-01, Session 5)

### T06 Completed: Terminate Child TS Workflow on Recovery
- Restructured `TerminateExistingWorkflowStep` in both Go and Java with a private helper method
- Go: `terminateWorkflow(ctx, executionID, workflowID, description)` encapsulates terminate+NOT_FOUND
- Java: `terminateWorkflowIfExists(workflowId, description, executionId, reason)` returns null on success
- Fixed early-return bug: orchestrator NOT_FOUND no longer skips child termination
- Step now terminates both orchestrator (`stigmer/workflow-execution/invoke/{id}`) and child (`workflow-exec-{id}`)
- Go: 8 unit tests with minimal `fakeTemporalClient` fake
- Java: 6 `@Nested` tests with Mockito + ArgumentCaptor
- Cleaned up stale `CTX_NEW_RUN_ID`/`CTX_RESET_EVENT_ID` references in Java test
- Committed: Go `ca65a92d9`, Java `7061f539`

### Design Decisions
- **Helper extraction over naive append**: The existing Go code had `return nil` on NOT_FOUND (line 649), which would skip child termination. Required restructuring, not just appending code.
- **Same step, not a new step**: The step's contract is "clear old Temporal state so recovery can proceed." Both orchestrator and child are part of that execution tree.
- **Orchestrator first, then child**: Kills the parent (stops signals to child), then hard-terminates the child regardless of ParentClosePolicy timing.
- **Follows `recreateExecutionContextStep` helper pattern**: That step already extracts `deleteStaleEC` and `resolveEnvironments` as private helpers. Same convention here.

## Session Progress (2026-06-01, Session 4)

### T05 Completed: React Event Store Reset on Recovery
- Added `isRecoveryTransition()` pure function to detect terminal-to-active phase transitions
- Added `prevPhaseRef` to track previous `executionPhase` across effect runs
- On recovery (FAILED→IN_PROGRESS), `store.reset()` clears stale events before re-subscribing from sequence 0
- Documented cleanup asymmetry with `useExecutionStream` (no reset in cleanup because `connectKey` reconnect is in deps)
- 17 new tests: 10 pure function (full transition matrix) + 7 hook integration (recovery reset, normal completion, initial load, null id, reconnect)
- All tests pass, lint clean, typecheck clean
- Committed: `392ce77d0`

### Architecture Decisions
- **`useRef` over `useState`** for previous phase tracking: the transition drives an effect-time side effect (store mutation + gRPC subscription), not a rendered value. Distinct from the `useState` "adjust state during render" pattern used for tab switching in inspectors.
- **No store reset in cleanup**: intentionally different from `useExecutionStream` because `connectKey` (reconnect) is in the deps array — resetting on cleanup would destroy events on reconnect.
- **Post-reset replays full history**: subscribing from sequence 0 replays old + new events. `deriveTaskStates` processes in order, so last event per task wins (task_skipped overrides old completed, task_started overrides old failed).

## Session Progress (2026-06-01, Session 3)

### T03 Completed: Recovery Flag Propagation (Java + Go)
- Added `RecoveryMode bool` to Go `InvokeWorkflowExecutionWorkflowInput` with `json:"recovery_mode,omitempty"` (matching `AutoApproveAll` pattern on agent execution input)
- Set `RecoveryMode: true` in Go `StartFreshWorkflowStep` (recover pipeline)
- Added `boolean recoveryMode` to Java `InvokeWorkflowExecutionWorkflowInput` record + overloaded `fromExecution()` factory (3-arg defaults false, 4-arg accepts explicit flag)
- Called 4-arg factory with `true` in Java `StartNewWorkflowStep` (recover handler)
- Updated doc comments in both Go `recover.go` and Java `WorkflowExecutionRecoverHandler` to describe task-level resume semantics
- Fixed pre-existing constructor arity in `InvokeWorkflowExecutionWorkflowImplTest` (was 6 args for 7-field record)
- Added Go test: `TestChildWorkflow_RecoveryModeAccepted`
- Added Java tests: `StartNewWorkflowStepTests`, `WorkflowInputTests` (factory overload + Jackson serialization round-trip)
- Go: all temporal workflow tests pass (10/10)
- TS: all 60 recovery/engine tests pass (do-executor-recovery + recovery + workflow-event-activities)
- Committed: Go `42bce319f`, Java `39377761`

### Design Validation
- Evaluated 4 alternative approaches (Temporal memo, auto-detect from event log, persist on proto, search attribute) — confirmed explicit-flag-on-workflow-input is architecturally correct
- Verified full backward/forward compatibility matrix (old/new orchestrator × old/new runner)
- Confirmed pattern precedent: `AutoApproveAll bool` on `InvokeAgentExecutionWorkflowInput`

## Prior Sessions

### T02 Completed (Session 2): Task-Level Resume in TS Engine
- Created `recovery.ts` — `RecoveryContext` type, `RecoveryTaskData` serialization type, `buildRecoveryContext` builder (sandbox-safe)
- Added `LoadRecoveryContext` activity — fetches execution status.tasks[], converts proto to plain objects for Temporal serialization boundary
- Wired `recovery_mode` through `ExecuteFromExecutionInput` → `RunWorkflowEngineOptions` → `engine-core.ts`
- Implemented skip logic in `do-executor.ts` — skips completed tasks, restores $context/$output via processTaskOutput/processTaskExport, emits task_skipped events, respects flow directives
- Recovery context deactivated after first non-skipped task to prevent accidental late skipping
- 23 new unit tests (8 recovery builder + 15 do-executor recovery), all 1370 runner tests pass

### T01 Completed (Session 1): Event Sequence Continuation (TS Runner)
- Replaced blind `resetSequenceCounter()` with `initSequenceFromEventLog(executionId)` that queries `getEventLog` for the persisted high-water mark
- Committed: `dd1a4e8cb fix(backend/runner): continue event sequence from high-water mark on recovery`

### Critical Discoveries (Sessions 1-2)
- **task_completed events don't carry output** — output_summary field exists in proto but is never populated. Recovery reads from status.tasks[].output instead (64KB truncation limit, acceptable for >99% of workflows)
- **T06 data race** — if T06 clears status.tasks[] before engine reads it, recovery data is lost. Recommendation: T06 should NOT clear status.tasks[] (engine's event emission naturally replaces stale entries)
- **Version pinning safety** — hydration uses workflowVersionHash, guaranteeing identical YAML between failed and recovery runs

## Next Steps

Pick the next task:

1. **T09** (Small) — Manual Verification (MongoDB reset) — needs all code deployed locally

All implementation, documentation, and integration test tasks (T01–T08) are complete. Only manual verification remains.

## Task Summary (9 tasks, ~1 week)

| Task | Description | Effort | Status |
|------|-------------|--------|--------|
| T01 | Event Sequence Continuation (TS Runner) | Small | **Done** ✅ |
| T02 | Task-Level Resume in TS Engine | Large | **Done** ✅ |
| T03 | Recovery Flag Propagation (Java + Go) | Small | **Done** ✅ |
| T04 | Fix Cursor Error Classification | Medium | **Done** ✅ |
| T05 | React Event Store Reset | Small | **Done** ✅ |
| T06 | Temporal Cleanup (Child Termination) | Small | **Done** ✅ |
| T07 | Integration Tests | Medium | **Done** ✅ |
| T08 | Proto + Documentation | Small | **Done** ✅ |
| T09 | Manual Verification (MongoDB reset) | Small | Blocked (needs all code) |

**Batch 1 (days 1-2):** ~~T01~~, ~~T04~~, ~~T05~~, ~~T06~~
**Sequential core (days 2-4):** ~~T02~~, ~~T03~~
**Validation (days 4-5):** ~~T07~~, ~~T08~~, T09

## Quick Commands

After loading context:
- "What to pick next?" - Get recommendation on next task
- "Continue with T04" - Start Cursor error classification fix
- "Continue with T02" - Start the core task-level resume work
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
