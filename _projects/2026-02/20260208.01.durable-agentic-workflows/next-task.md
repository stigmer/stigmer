# Next Task: 20260208.01.durable-agentic-workflows

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260208.01.durable-agentic-workflows

**Description**: Make Stigmer a fully durable agentic workflow platform with all 5 durability layers - workflow-level, agent-level, tool-level, ingress-level, and ops-level guarantees
**Goal**: Implement the complete durability stack so agent tasks resume after crashes and long pauses, tool side effects are protected via idempotency, and events are delivered race-free
**Tech Stack**: Go, Python, TypeScript, Temporal, LangGraph
**Components**: Agent executor, workflow engine, tool execution layer, event ingress, worker deployment

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260208.01.durable-agentic-workflows/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-08 12:26
**Last Session**: 2026-02-09 17:46 - Gap A3: Pause/Resume Implementation
**Current Task**: Gap A3 Complete - Ready for Integration Testing
**Status**: IMPLEMENTED - Proto, Go, Java, Python complete

## Session Progress (2026-02-09 17:46)

### Gap A3: Pause/Resume Implementation Complete

**Completed**:
- ✅ Proto: Added `EXECUTION_PAUSED` phase to workflowexecution and agentexecution enums
- ✅ Proto: Added `pause` and `resume` RPCs to command.proto with input messages
- ✅ Regenerated all language stubs (Go, Python)
- ✅ Go: Added 4 new lifecycle pipeline steps (ValidatePausable, ValidateResumable, SignalPause, SignalResume)
- ✅ Go: Created `pause.go` and `resume.go` handlers following lifecycle pattern
- ✅ Java: Added pause/resume signal methods to workflow interface and implementation
- ✅ Java: Rewrote `executeWorkflowFlow()` with CancellationScope and pause/resume loop
- ✅ Python: Added graceful cancellation handling in `execute_graphton.py`
- ✅ Python: Added PAUSED status reporting and checkpoint preservation
- ✅ Checkpoint created: `checkpoints/2026-02-09-gap-a3-pause-resume-complete.md`
- ✅ Changelog created: `_changelog/2026-02/2026-02-09-174619-implement-pause-resume-for-workflows.md`

**Key Decisions**:
- Pause via Temporal signal + CancellationScope for graceful activity cancellation
- PAUSED as non-terminal phase (can transition back to IN_PROGRESS)
- LangGraph automatic checkpointing on cancellation (no data loss)
- Idempotent operations (pause PAUSED, resume IN_PROGRESS are no-ops)
- Scope: Workflow execution only (agent execution lifecycle is follow-up)

**Files Modified**:
- stigmer: 25 files (4 protos + 12 stubs + 3 Go + 1 Python + 2 BUILD + 3 unrelated)
- stigmer-cloud: 2 files (Java workflow interface + implementation)
- Total: ~2,300 lines added

---

## Session Progress (2026-02-08 17:57)

### Gap B2: Event Deduplication Implementation Complete

**Completed**:
- ✅ Proto API: Added `idempotency_key` field to `SendSignalInput` message
- ✅ Regenerated all language stubs (Go, Python)
- ✅ Go: `SignalDedupeStore` interface with SQLite implementation
- ✅ Go: `DedupeClaimStep` and `DedupeMarkDeliveredStep` pipeline steps
- ✅ Go: Comprehensive unit tests for dedupe store
- ✅ Java: `SignalDedupeStore`, `SignalDedupeRecord`, `SignalDedupeRepo` (MongoDB)
- ✅ Java: Dedupe pipeline steps in `WorkflowExecutionSendSignalHandler`
- ✅ Changelog created: `_changelog/2026-02/2026-02-08-175743-gap-b2-event-deduplication.md`

**Key Decisions**:
- MongoDB (Java/cloud) and SQLite (Go/local) for durable dedupe storage
- Per-organization key scoping to prevent cross-org collisions
- 24-hour TTL matching industry standards (Stripe, GitHub)
- Optional idempotency key for backward compatibility
- Graceful degradation - dedupe failures don't block signal delivery

**Files Modified**:
- stigmer: 5 files (new dedupe package + proto update)
- stigmer-cloud: 4 files (new dedupe package)

---

## Session Progress (2026-02-08 16:41)

### Gap B1: Signal-With-Start Implementation Complete

**Completed**:
- ✅ Proto API: Added `SendSignalInput` message and `sendSignal` RPC to `workflowexecution/v1/command.proto`
- ✅ Regenerated all language stubs (Go, Java, Python, TypeScript, Dart)
- ✅ Go: `SignalWithStart` method in `InvokeWorkflowExecutionWorkflowCreator`
- ✅ Go: `SendSignal` handler with 4-step validation pipeline
- ✅ Go: Unit tests for phase validation (terminal phases reject signals)
- ✅ Java: `signalWithStart` method in `InvokeWorkflowExecutionWorkflowCreator`
- ✅ Java: `WorkflowExecutionSendSignalHandler` with 5-step pipeline
- ✅ Changelog created: `_changelog/2026-02/2026-02-08-164113-signal-with-start-api.md`

**Key Decisions**:
- Chose **Pattern 2** (signal delivery to LISTEN tasks) over Pattern 1 (event-driven workflow creation)
- Pattern 1 deferred as future platform feature - requires webhook ingress system
- Phase validation: Only PENDING and IN_PROGRESS executions can receive signals
- Used Temporal's atomic SignalWithStart API to eliminate race conditions

**Files Modified**:
- stigmer: 16 files (805 insertions, 77 deletions)
- stigmer-cloud: 77 files (6503 insertions, 17747 deletions - mostly stub regeneration)

## Implementation Complete (2026-02-08)

### What Was Implemented

**Gap A1: Durable Agent Sessions (Crash Recovery)**

1. **Heartbeat with thread_id** (`execute_graphton.py`)
   - Added `thread_id` to heartbeat payload for checkpoint identification
   - Heartbeat sent every 2 seconds with checkpoint info

2. **Retry Detection & Resume** (`execute_graphton.py`)
   - Activity detects retry via `activity.info().attempt > 1`
   - Extracts `thread_id` from `heartbeat_details`
   - LangGraph automatically resumes from checkpoint using same `thread_id`

3. **Enabled Activity Retries** (`InvokeAgentExecutionWorkflowImpl.java`)
   - Changed from `setMaximumAttempts(1)` to `setMaximumAttempts(3)`
   - Added backoff: 10s initial, 2.0 coefficient, 1m max

4. **Documentation** (`graphton/README.md`)
   - Added "Durable Execution & Tool Idempotency" section
   - Guidelines for making tools idempotent

### Design Decision: No Tool Ledger

We decided NOT to implement a Redis-backed tool ledger because:
- LangGraph checkpoints provide durability for 90%+ of cases
- The edge case (crash during tool execution before checkpoint) is rare
- Complexity cost exceeds benefit
- Tool idempotency is better solved at the tool level (API idempotency keys)

### Files Modified

| File | Change |
|------|--------|
| `stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py` | + thread_id in heartbeat, + retry detection, + checkpoint resume |
| `stigmer-cloud/.../InvokeAgentExecutionWorkflowImpl.java` | + setMaximumAttempts(3), + backoff config |
| `stigmer/backend/libs/python/graphton/README.md` | + Durable Execution documentation |

## Testing Instructions

### Manual Crash Recovery Test

1. **Start an agent execution** with a multi-step task:
   ```bash
   stigmer agent exec "Research quantum computing and create a summary file"
   ```

2. **Wait for progress** (watch logs for checkpoint saves):
   ```bash
   # Look for heartbeat logs with thread_id
   docker logs agent-runner 2>&1 | grep "thread_id"
   ```

3. **Kill the agent-runner** mid-execution:
   ```bash
   docker kill agent-runner
   ```

4. **Restart the worker**:
   ```bash
   docker start agent-runner
   ```

5. **Verify resume**:
   - Check logs for: `RETRY DETECTED: attempt=2, resuming from thread_id=...`
   - Verify agent continues from checkpoint (not from beginning)
   - Verify execution completes successfully

### Expected Log Output on Retry

```
🔄 RETRY DETECTED: attempt=2, resuming from checkpoint with thread_id=exec-123-abc (original thread_id=exec-123-xyz)
```

## Next Steps

1. **Integration Test Gap B1 & B2** with running Temporal cluster
   - Test signal delivery to PENDING workflow
   - Test signal delivery to IN_PROGRESS workflow
   - Verify race condition handling with concurrent signals
   - Test phase validation (terminal states reject signals)
   - Test idempotency key deduplication
   - Test duplicate signal rejection with ALREADY_EXISTS

2. **Manual Test Gap B1 & B2** with LISTEN task workflow
   - Create workflow with LISTEN task waiting for external signal
   - Use `sendSignal` RPC to send signal with idempotency_key
   - Verify duplicate signals return same response
   - Verify workflow resumes and receives payload data

3. **Gap A3: Pause/Resume Propagation** for graceful agent pausing

4. **Gap B6: ISO 8601 Wait Semantics** for standardized duration formats

5. **Gap C1: Workflow-Level Checkpointing** (depends on Gap B1)

## Context for Resume

- Plan file: `plans/durable_agentic_gaps_validation_6b7f2afa.plan.md`
- Research report: `research.making-stigmer-fully-durable-agentic/04.report.gpt.md`
- Agent executor code: `stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py`
- Workflow orchestrator: `stigmer-cloud/.../InvokeAgentExecutionWorkflowImpl.java`

## Quick Commands

After loading context:
- "Start implementing Gap A1 + A2" - Begin heartbeat checkpoint + tool idempotency
- "Show me the execute_graphton.py heartbeat code" - Review current heartbeat implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
