# Next Task: 20260307.01.execution-context-lifecycle

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260307.01.execution-context-lifecycle

**Description**: Implement proper ExecutionContext lifecycle for agent execution: create ExecutionContext with fully-merged environment during execution creation, pass only a slim input (no secrets) to the Temporal workflow, and clean up the ExecutionContext when execution completes.
**Goal**: Remove secrets from Temporal workflow history, introduce server-side ExecutionContext creation with full environment merging (agent defaults + environment_refs + runtime_env), strip runtime_env from persisted AgentExecution, and add ExecutionContext cleanup on workflow completion.
**Tech Stack**: Go/Temporal/gRPC/Protocol Buffers/Python
**Components**: backend/services/stigmer-server (create pipeline, Temporal workflow, activities, downstream clients), backend/services/agent-runner (already supports ExecutionContext - no changes needed)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260307.01.execution-context-lifecycle/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-07 01:47
**Current Task**: T01 (Create Downstream Clients) -- COMPLETED
**Status**: T01 complete, ready for T02

## Session Progress (2026-03-07)

- **T01 completed**: Created two downstream gRPC clients (Environment query, ExecutionContext command)
- Files created:
  - `backend/services/stigmer-server/pkg/downstream/environment/client.go` -- query-only client with `GetByReference`
  - `backend/services/stigmer-server/pkg/downstream/executioncontext/client.go` -- command-only client with `Create` and `Delete`
- Both follow the exact established downstream client pattern (7 existing clients as reference)
- Verified: `go build ./backend/services/stigmer-server/...` compiles cleanly
- No existing files modified

## Next Steps

1. **T02: CreateExecutionContextStep** -- Add a pipeline step to the agent execution creation flow that builds and persists an ExecutionContext with the fully-merged environment (agent defaults + environment_refs + runtime_env). Wire the new downstream clients into the server.
2. **T03: Slim Workflow Input** -- Change the Temporal workflow input from full AgentExecution proto to a slim struct without secrets. Strip runtime_env from persisted AgentExecution.
3. **T04: Cleanup Activity** -- Add a Temporal activity that deletes the ExecutionContext when the workflow completes (success or failure).

## Context for Resume

- The Environment client only exposes `GetByReference` (query-only, since the execution domain never mutates environments)
- The ExecutionContext client only exposes `Create` and `Delete` (command-only, since query operations like `getByExecutionId` are used by agent-runner directly)
- The `Delete` method follows the `ApiResourceDeleteInput` pattern from the mcpserver downstream client
- Server wiring (connecting these clients to the in-process gRPC server) is deferred to T02

## Quick Commands

After loading context:
- "Start T02" - Begin the CreateExecutionContextStep task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
