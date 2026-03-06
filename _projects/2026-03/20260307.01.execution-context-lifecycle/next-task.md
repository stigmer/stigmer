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
**Current Task**: T02 (CreateExecutionContext Pipeline Step) -- COMPLETED
**Status**: T02 complete, ready for T03

## Session Progress (2026-03-07 -- Session 2)

- **T02 completed**: Added CreateExecutionContext pipeline step to BOTH AgentExecution and WorkflowExecution creation flows
- Extracted shared three-layer environment merge utility (`envmerge.MergeEnvironmentLayers`)
- Extended 3 downstream clients with new `Get` methods (session, agentinstance, workflowinstance)
- Wired environment + executioncontext clients into both controllers via server.go

### New files created (3):
  - `backend/libs/go/envmerge/merge.go` -- shared pure merge function (template env_spec + environments + runtime_env -> ExecutionValue map)
  - `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create_execution_context_step.go` -- AE pipeline step (session -> instance -> agent resolution chain)
  - `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create_execution_context_step.go` -- WE pipeline step (instance -> workflow via store resolution chain)

### Modified files (8):
  - `downstream/session/client.go` -- added `queryClient` + `Get(id)` method
  - `downstream/agentinstance/client.go` -- added `Get(id)` method
  - `downstream/workflowinstance/client.go` -- added `queryClient` + `Get(id)` method
  - `agentexecution/controller/agentexecution_controller.go` -- added environmentClient, executionContextClient; expanded SetClients
  - `agentexecution/controller/create.go` -- inserted CreateExecutionContext step into pipeline
  - `workflowexecution/controller/workflowexecution_controller.go` -- added environmentClient, executionContextClient; added setter
  - `workflowexecution/controller/create.go` -- inserted CreateExecutionContext step into pipeline
  - `server/server.go` -- created + injected environment and executioncontext clients into both controllers

### Design decisions:
  - Shared merge lives in `backend/libs/go/envmerge/` (pure function, no I/O, easily testable)
  - AE step uses downstream gRPC clients for all lookups (matching AE controller pattern)
  - WE step loads Workflow from store directly (matching WE controller's "same service" pattern)
  - EnvironmentValue entries with empty value are filtered (schema declarations, not runtime config)
  - ExecutionContext is always created even with empty data map (contract consistency)

- Verified: `go build ./backend/services/stigmer-server/...` and `go build ./backend/libs/go/envmerge/...` both compile cleanly

## Session Progress (2026-03-07 -- Session 1)

- **T01 completed**: Created two downstream gRPC clients (Environment query, ExecutionContext command)
- Files created:
  - `backend/services/stigmer-server/pkg/downstream/environment/client.go` -- query-only client with `GetByReference`
  - `backend/services/stigmer-server/pkg/downstream/executioncontext/client.go` -- command-only client with `Create` and `Delete`
- Both follow the exact established downstream client pattern (7 existing clients as reference)
- Verified: `go build ./backend/services/stigmer-server/...` compiles cleanly
- No existing files modified

## Next Steps

1. **T03: Slim Workflow Input** -- Change the Temporal workflow input from full AgentExecution proto to a slim struct without secrets. Strip runtime_env from persisted AgentExecution.
2. **T04: Cleanup Activity** -- Add a Temporal activity that deletes the ExecutionContext when the workflow completes (success or failure).

## Context for Resume

- T01 created Environment + ExecutionContext downstream clients; T02 wired them into the server and both execution controllers
- The merge function in `backend/libs/go/envmerge/merge.go` converts EnvironmentValue -> ExecutionValue, filtering empty values
- After T02, there is temporary redundancy: runtime_env exists in both the execution AND the execution context. T03 removes it from the execution.
- The AE step resolves agent_instance_id from pipeline context (DefaultInstanceIDKey) or by looking up the session via sessionClient.Get
- The WE step resolves workflow_instance_id from execution.spec (always set by createDefaultInstanceIfNeededStep)
- No proto changes were made in T01 or T02

## Quick Commands

After loading context:
- "Start T03" - Begin the Slim Workflow Input task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
