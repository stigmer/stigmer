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
**Current Task**: T01 (Gap Validation Complete - Ready for Implementation)
**Status**: Ready to Execute

## Session Progress (2026-02-08)

### Accomplished
- Validated research report gaps against actual Stigmer codebase
- Confirmed 8 of 9 gaps exist and need implementation
- Created prioritized implementation plan in `plans/durable_agentic_gaps_validation_6b7f2afa.plan.md`

### Critical Discovery
Activity retries are **disabled** (`setMaximumAttempts(1)`) because "agent execution not idempotent". This means:
- System fails instead of recovering from crashes
- Not actually durable - just avoiding the problem
- Fixing Gap A1 + A2 will enable true crash recovery

### Gap Validation Results

| Gap | Status | Priority |
|-----|--------|----------|
| A1: Durable Agent Sessions | GAP CONFIRMED | Highest |
| A2: Tool Idempotency | GAP CONFIRMED | Highest |
| A3: Pause Propagation | PARTIAL | Medium |
| B1: Signal-With-Start | GAP CONFIRMED | High |
| B2: Event Dedupe | GAP CONFIRMED | High |
| B3: Human Tasks | PARTIAL | Low |
| B4: Workflow Versioning | GAP CONFIRMED | Medium |
| B5: Saga/Compensation | GAP CONFIRMED | Low |
| B6: Wait Semantics | GAP CONFIRMED | Low |

### Existing Foundation (Ready to Build On)
- Continue-As-New: Production-ready
- Claim Check: Production-ready
- LangGraph Checkpointer: Exists (MongoDB/SQLite)
- Thread-based State: Working
- HITL Approval Flow: Working
- Heartbeats: Sent every 2 seconds (just needs checkpoint_id)
- Cancel/Terminate: Working

### Key Files Identified for Implementation
- `stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py` - Add checkpoint_id to heartbeat
- `stigmer-cloud/.../InvokeAgentExecutionWorkflowImpl.java` - Enable retries after idempotency
- `stigmer/backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` - Add idempotency

## Next Steps

1. **Implement Gap A1 + A2 together** (they are interdependent):
   - Add `checkpoint_id` to heartbeat payload
   - Build tool call ledger with idempotency keys
   - Wrap tool execution with ledger lookup
   - Implement checkpoint resume on activity retry
   - Enable activity retries (`setMaximumAttempts(3)`)
   - Test crash recovery

2. After A1 + A2, implement Gap B1 (Signal-With-Start) for race-proof event delivery

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
