# Thread Invoker Identity Through Temporal Workflow Inputs

**Date**: March 25, 2026

## Summary

Added `invokerIdentityAccountId` to both agent execution and workflow execution Temporal workflow inputs, bridging the gap between stigmer-service (which knows the caller identity) and the runners (which need it for on-behalf-of gRPC impersonation). For workflow execution, replaced the full `WorkflowExecution` proto with a slim `InvokeWorkflowExecutionWorkflowInput` record, removing secrets from Temporal's durable workflow history.

## Problem Statement

Runners (agent-runner in Python, workflow-runner in Go) need the identity of the user who triggered an execution to attach the `x-on-behalf-of` gRPC header on downstream calls. This identity is available in the handler context at workflow start time but was not threaded through the Temporal workflow inputs to the activity layer where runners receive it.

### Pain Points

- Runners had no way to know which user triggered the execution
- All runner gRPC calls used the machine account identity, meaning system-created resources were owned by the machine — not the user
- Workflow execution passed the full `WorkflowExecution` proto (including `runtime_env` with secrets) as the Temporal workflow input, leaking sensitive data into durable workflow history
- Agent execution already had a slim input pattern but lacked the invoker identity field

## Solution

Threaded `invokerIdentityAccountId` from handler context through Temporal workflow inputs to activity interfaces in both execution flows:

1. **Agent execution** — Extended the existing slim input record with the new field (trivial addition)
2. **Workflow execution** — Created a new `InvokeWorkflowExecutionWorkflowInput` slim record replacing the full proto, aligning both flows on the same pattern and eliminating secrets from history

## Implementation Details

### Part 1: Agent Execution (extend existing slim input)

**stigmer-cloud (Java, 4 files):**
- `InvokeAgentExecutionWorkflowInput.java` — Added `invokerIdentityAccountId` field, updated `fromExecution()` factory to accept identity from handler context
- `AgentExecutionCreateHandler.java` — Passes `context.getCaller().getIdentityAccountId()` to factory
- `InvokeAgentExecutionWorkflowImpl.java` — Threads identity to both `executeGraphton()` call sites (initial and HITL re-invocation)
- `ExecuteGraphtonActivity.java` — Added 4th parameter to activity interface

**stigmer (Go + Python, 2 files):**
- `workflow_input.go` — Added `InvokerIdentityAccountID` field to Go struct
- `execute_graphton.py` — Added `invoker_identity_account_id` parameter (accepted but unused until T05)

### Part 2: Workflow Execution (new slim input replacing full proto)

**stigmer-cloud (Java, 7 files):**
- **NEW** `InvokeWorkflowExecutionWorkflowInput.java` — Java record with 6 fields (executionId, workflowInstanceId, workflowId, orgId, callbackToken, invokerIdentityAccountId) and `fromExecution()` factory
- Updated workflow interface, impl, creator, activity interface, and both handlers (CreateHandler + SendSignalHandler) to use slim input

**stigmer (Go — stigmer-server, 6 files):**
- `activities/execute_workflow.go` — Added `InvokeWorkflowExecutionWorkflowInput` struct and updated activity stub interface
- Updated workflow interface, impl, creator to reference type from activities package
- Updated controller `create.go` and `send_signal.go` to build slim input

**stigmer (Go — workflow-runner, 2 files):**
- `execute_workflow_activity.go` — Changed from `*WorkflowExecution` proto to local `InvokeWorkflowExecutionWorkflowInput`, removed `runtime_env` fallback path
- `worker.go` — Updated comment for new activity signature

### Go Import Cycle Resolution

Moving the shared input type to the `activities` package (instead of `workflows`) resolved an import cycle: `workflows` imports `activities` for stubs, so shared types must live in the lower-level package. This is the standard Go pattern for breaking circular dependencies.

## Benefits

- **Security**: Secrets (`runtime_env`) no longer appear in Temporal's durable workflow history for workflow executions
- **Identity threading**: Runners now receive the invoker identity, enabling on-behalf-of impersonation in T05/T06
- **Consistency**: Both agent and workflow execution flows now use the same slim input pattern
- **Cleaner architecture**: Workflow activity receives only the IDs it needs to hydrate context via gRPC, rather than a full proto with fields it never accessed

## Impact

- **stigmer-cloud**: 10 modified + 1 new Java file
- **stigmer (stigmer-server)**: 6 modified Go files
- **stigmer (workflow-runner)**: 2 modified Go files
- **stigmer (agent-runner)**: 1 modified Python file
- **Breaking change**: In-flight workflow executions will fail to deserialize on deploy (max 30 min drain needed)
- **Cross-repo coordination**: Java and Go/Python changes must deploy together

## Related Work

- Prerequisite: `20260325.02.sp.on-behalf-of-grpc-channel` — built the impersonation infrastructure
- Previous: T01-T03 wired `createOnBehalfOf` into all `createAsSystem` call sites
- Next: T05 (agent-runner OBO) and T06 (workflow-runner OBO) will use the threaded identity

---

**Status**: ✅ Production Ready
**Timeline**: Single session
