# Next Task: 20260207.04.execution-lifecycle-control

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260207.04.execution-lifecycle-control

**Description**: Add user-facing retry, cancel, and resume capabilities for workflow and agent executions to fulfill the 'durable workflows' promise
**Goal**: Enable users to cancel running executions, retry failed executions, and resume from checkpoints - completing the durability story for agentic workflows
**Tech Stack**: Go/gRPC, Protobuf, Temporal, CLI (Cobra)
**Components**: apis/workflowexecution, apis/agentexecution, backend handlers, CLI commands, Temporal integration

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.04.execution-lifecycle-control/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-07 13:52
**Current Task**: T0 (WorkflowRunner Cleanup)
**Status**: APPROVED - Ready for Execution

## Active Plan

**File**: `tasks/T01_2_final_plan.md`

### Research Validation
- DeepSeek/ChatGPT research completed (07.report.gpt.md)
- Recommendation: **Option C (Minimal Viable Both)**
- Key insight: "retry and resume" claim requires cancel + recover APIs

### MVP Scope (Research-Validated)

| Feature | Domain Term | Description |
|---------|-------------|-------------|
| Graceful Stop | `cancel` | Stop running execution gracefully |
| Hard Stop | `terminate` | Force stop immediately |
| Recover from Failure | `recover` | Continue from checkpoint (Temporal Reset) |
| Enhanced Wait | `wait` | ISO durations + "until" timestamp |

### Execution Order

```
T0: Remove WorkflowRunner gRPC interface (FIRST - cleanup)
T1: Add EXECUTION_TERMINATED enum
T2: Add cancel/terminate/recover RPCs
T3: Add IO messages
T4: Implement backend handlers
T5: Add CLI commands
T6: Expand WaitTaskConfig
T7: Update wait converter
```

### Key Architecture Decision

**Remove dual control plane**: WorkflowRunner gRPC interface deleted. Lifecycle control happens at Stigmer service level via direct Temporal API.

## Quick Commands

After loading context:
- "Start T0 cleanup" - Begin WorkflowRunner cleanup
- "Continue with the plan" - Resume execution
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
