# T03: Slim Workflow Input and runtime_env Stripping

**Date**: March 7, 2026

## Summary

Removed secrets from Temporal workflow history by introducing a slim workflow input type for agent executions and stripping `runtime_env` from persisted executions. This change spans both the OSS (Go) and Cloud (Java) codebases, affecting the entire AE and WE Temporal workflow chain. A latent stale-data bug in the callback result path was also fixed.

## Problem Statement

After T02 introduced the `createExecutionContextStep`, `runtime_env` (which may contain secrets like API keys) was consumed to build the server-side `ExecutionContext`, but it still lingered in two places:

1. **Persisted execution** -- secrets stored alongside the execution resource in the database
2. **Temporal workflow history** -- the full `AgentExecution` proto (including `runtime_env`) was passed as the workflow input, making secrets visible in Temporal's durable event history

### Pain Points

- Security risk: secrets in Temporal history are accessible to anyone with Temporal UI/CLI access
- Unnecessary payload size: the full proto included fields the workflow never accessed (message, attachments, runtime_env)
- Stale-data bug: the AE workflow's `completeExternalActivity` passed the creation-time execution snapshot (not the completion-time state) back to the parent Zigflow workflow

## Solution

A three-part implementation applied to both OSS Go and Cloud Java:

**Part A** -- Clear `runtime_env` from the execution object inside `createExecutionContextStep` immediately after the ExecutionContext is created. The field is transient: consumed once, then discarded.

**Part B** -- Replace the full `AgentExecution` proto workflow input with a slim type (`InvokeAgentExecutionWorkflowInput`) carrying only the 6 orchestration fields the workflow actually needs: `executionId`, `sessionId`, `agentId`, `callbackToken`, `autoApproveAll`, `parentWorkflowId`.

**Part C** -- Add a `LoadAgentExecution` local activity (OSS Go) that loads the current execution from the database before completing the external activity, ensuring the callback result reflects the completion-time state.

## Implementation Details

### Slim Input Type

- **Go**: Plain struct with JSON tags in `workflow_input.go`
- **Java**: Record with `fromExecution()` factory method in `InvokeAgentExecutionWorkflowInput.java`
- Native types chosen over proto because the workflow input never crosses a language boundary (Go starts Go workflows, Java starts Java workflows)

### Full Workflow Chain Updated

Interface → Implementation → Creator → StartWorkflowStep all updated to accept the slim input in both languages.

### WE Workflow Input Unchanged

The WorkflowExecution workflow keeps the full proto (with `runtime_env` cleared). The `ExecuteWorkflow` activity is implemented by `workflow-runner` and expects the full proto. Changing it would require cross-service changes for no additional security benefit since the field is already empty.

### Files Changed

| Repo | New | Modified | Total |
|------|-----|----------|-------|
| OSS Go | 2 | 7 | 9 |
| Cloud Java | 1 | 6 | 7 |

## Benefits

- **Security**: Secrets never appear in Temporal workflow history or persisted execution resources
- **Payload reduction**: AE workflow input shrinks from a full proto (potentially KB+ with message/attachments) to ~200 bytes
- **Data correctness**: Callback result now reflects completion-time state, not a stale creation-time snapshot
- **Clean architecture**: Workflow input carries only what the workflow needs -- no more "data bag" pattern

## Impact

- **Breaking change**: AE workflow input type change breaks in-flight AE workflows on replay. Mitigation: drain running AE workflows before deployment.
- **WE change is non-breaking**: Same proto type, just an empty field.
- **No proto changes**: All changes are in application code (Go/Java). No API contract changes.

## Related Work

- **T01**: Created Environment and ExecutionContext downstream clients
- **T02**: Added `createExecutionContextStep` to both AE and WE pipelines (created the server-side ExecutionContext)
- **T04** (next): Add cleanup activity to delete ExecutionContext when workflow completes

---

**Status**: ✅ Production Ready (pending deployment with workflow drain)
**Timeline**: Session 3 of project 20260307.01.execution-context-lifecycle
