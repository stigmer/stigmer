# Architectural Gap: `run_workflow` Does Not Create a Child WorkflowExecution DB Record

**Created:** 2026-05-24  
**Context:** Agent Call Live Experience investigation (Phase B — `run_workflow` progress)  
**Status:** Documented gap, not blocking current effort

---

## The Gap

When a workflow DSL uses `run: workflow: name: "child-workflow"`, the runner calls Temporal `executeChild(config.name)` directly inside the already-running workflow engine. This:

1. Does NOT call `WorkflowExecution.create` via the API
2. Does NOT persist a `WorkflowExecution` resource in the database
3. Does NOT start the registered `stigmer/workflow/execute-from-execution` Temporal type
4. Does NOT emit workflow execution events for the child
5. Means the frontend CANNOT subscribe to child workflow progress (no event stream exists)

The child workflow name (`config.name`) is treated as a Temporal workflow TYPE, not a Stigmer workflow resource slug. The runner only registers 4 workflow types: `stigmer/workflow/execute`, `stigmer/workflow/execute-from-execution`, `stigmer/mcp-server/connect`, `stigmer/mcp-server/discover`.

## How Top-Level Executions Work (Correct Path)

For comparison, the correct path for a tracked workflow execution:

```
API WorkflowExecution.create
→ Persist to DB (gets wfx_id)
→ Start Temporal: stigmer/workflow-execution/invoke (Go orchestrator)
  → Child workflow: stigmer/workflow/execute-from-execution (TS runner)
    → Hydrate: fetch workflow YAML, env, input by execution_id
    → runWorkflowEngine(input) — has metadata.execution_id
    → Events emitted to DB via gRPC updateStatus
```

## How `run_workflow` Works Today (Incomplete Path)

```
Parent engine running → DSL task: run: workflow: name: "child-workflow"
→ RunTaskBuilder → ctx.runWorkflow({ name, input, await: true })
→ orchestrateRunWorkflow() → executeChild("child-workflow", [input])
→ Temporal tries to start "child-workflow" as a workflow type
→ FAILURE: "child-workflow" is not a registered workflow type
```

This feature appears scaffolded but not fully wired for production use.

## Proposed Solution (Future Work)

To make `run_workflow` create a first-class `WorkflowExecution` with its own event stream:

### Option A: Route Through the API

1. `RunTaskBuilder` calls an activity that invokes `WorkflowExecution.create` on the server
2. Server creates the DB record and starts `stigmer/workflow-execution/invoke`
3. That starts `stigmer/workflow/execute-from-execution` (the registered type)
4. Child execution has its own `wfx_id`, event stream, and status

**Pros:** Full lifecycle tracking, subscribable from frontend, consistent with top-level executions  
**Cons:** API call overhead, child is a separate entity (needs parent/child relationship tracking)

### Option B: Direct Child with DB Record

1. Modify `run-orchestrator.ts` to:
   - Create a WorkflowExecution record via a local activity (lightweight)
   - Call `executeChild("stigmer/workflow/execute-from-execution", { execution_id })` (registered type)
   - Child hydrates and runs with full event emission
2. Store `child_workflow_execution_id` on the parent task for progress linking

**Pros:** No extra API hop, child is tracked, uses existing infrastructure  
**Cons:** Requires the child workflow to be pre-resolved (YAML must be available by ID)

### Option C: In-Process with Event Forwarding

1. Keep `executeChild(config.name)` pattern (direct YAML execution)
2. But register a "workflow/execute-inline" type that accepts a pre-resolved model
3. Forward child events to the parent's event stream (prefixed with task name)

**Pros:** No API calls, no separate DB record needed  
**Cons:** No independent lifecycle, events pollute parent stream, no separate subscription

## Recommendation

**Option B** is the cleanest architectural fit. It leverages the existing `stigmer/workflow/execute-from-execution` infrastructure, gives the child its own DB record and event stream (enabling frontend subscription), and only requires:

1. A local activity in `run-orchestrator.ts` to create the child `WorkflowExecution` record
2. Changing `executeChild` to use the registered workflow type with the child's `execution_id`
3. Storing `child_workflow_execution_id` on the parent task's metadata (like agent_call stores `childExecutionId`)

This mirrors the `agent_call` pattern: parent creates child entity, child runs independently, parent can subscribe to child's stream for progress.

## Related Files

| File | Role |
|------|------|
| `backend/services/runner/src/workflows/run-orchestrator.ts` | Current `executeChild` implementation |
| `backend/services/runner/src/workflow-engine/tasks/run.ts` | `RunTaskBuilder` |
| `backend/services/runner/src/workflows/execute-from-execution.ts` | The correct wrapper (hydration + engine) |
| `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go` | Server-side creation + Temporal start |
