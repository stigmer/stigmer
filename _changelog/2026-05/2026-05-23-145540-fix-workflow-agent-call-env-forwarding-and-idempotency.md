# Fix Workflow agent_call Env Var Forwarding and Recovery Idempotency

**Date**: May 23, 2026

## Summary

Fixed two critical bugs in the workflow `agent_call` pipeline: (1) workflow environment variables were computed but never actually sent to child agent executions, causing MCP servers to fail with "requires environment variable which is not provided"; and (2) `ALREADY_EXISTS` errors on workflow recovery caused hard failures instead of graceful session reuse and execution retry.

## Problem Statement

When running the `daily-notification-plan` workflow via the desktop app, the `run_analyst` agent_call task failed immediately with:

> `[ConnectError] [failed_precondition] MCP server 'postgres' requires environment variable 'POSTGRES_CONNECTION_URL' which is not provided.`

The user had entered `POSTGRES_CONNECTION_URL` in the Run Workflow dialog, and the value was correctly stored in the workflow's `ExecutionContext`. However, when the `CallAgent` activity spawned a child `AgentExecution`, the env var never reached it.

Additionally, when attempting to recover a failed workflow execution, the deterministic session names collided with resources from the previous attempt, producing `ALREADY_EXISTS` errors that blocked recovery entirely.

### Pain Points

- Workflow-declared env vars never reached child agents, making any workflow with MCP-dependent agents non-functional
- The intersection-forwarding logic in `call-agent.ts` was dead code — it built the `executionRuntimeEnv` map but never wired it into the gRPC create call
- Workflow recovery (`Recover` button) failed with `ALREADY_EXISTS` for both sessions and executions
- No integration test coverage existed for env var propagation through `agent_call` tasks

## Solution

Three-part fix addressing the root cause, enabling recovery, and adding regression coverage:

1. **Wire `executionRuntimeEnv` into `AgentExecutionSpec.runtimeEnv`**: Convert the computed env map to `ExecutionValue` proto objects and pass them on the `createAgentExecution` gRPC call.

2. **Graceful `ALREADY_EXISTS` handling**: On session collision, extract the existing session ID from the error message and reuse it. On execution collision, create a retry execution with a timestamp-suffixed name in the same session.

3. **Test coverage**: Unit tests for env forwarding (secret propagation, intersection filtering, override precedence, ALREADY_EXISTS recovery) and integration tests for the end-to-end workflow-to-child-agent env propagation path.

## Implementation Details

### Env Var Forwarding (`call-agent.ts`)

The `executionRuntimeEnv` map — built by intersecting workflow `state.env` with the child agent's declared `spec.env` keys — was correctly computed but never referenced in the `createAgentExecution` call. The fix converts it to `ExecutionValue` proto objects and passes it as `runtimeEnv` on the `AgentExecutionSpec`:

```typescript
const runtimeEnvProto: Record<string, ExecutionValue> = {};
for (const [key, val] of Object.entries(executionRuntimeEnv)) {
  runtimeEnvProto[key] = create(ExecutionValueSchema, {
    value: val.value,
    isSecret: val.isSecret,
  });
}
```

The server-side `createExecutionContextStep` already merges `runtime_env` into the `ExecutionContext` at the highest priority — no server changes needed.

### Session ALREADY_EXISTS Recovery

On `Code.AlreadyExists` from session creation, the handler now extracts the existing resource ID from the error message (pattern: `(id: <resource_id>)`) and reuses that session for the execution. This enables workflow recovery to continue using the session from the previous failed attempt.

### Execution ALREADY_EXISTS Recovery

On `Code.AlreadyExists` from execution creation, a retry execution is created in the same session with a timestamp-suffixed name (`aex-wf-{taskKey}-r{timestamp}`). This preserves session continuity while avoiding name collision.

### Unit Tests (6 new)

- `runtimeEnv` populated when agent declares matching env vars
- `isSecret` flag correctly propagated from agent env declarations
- Undeclared vars excluded from forwarding (intersection semantics)
- Task-config env overrides auto-forwarded values
- Session `ALREADY_EXISTS` recovery extracts and reuses existing session ID
- Execution `ALREADY_EXISTS` creates retry execution with unique name

### Integration Tests (2 new)

- `TestWorkflowAgentCall_EnvVarsForwardedToChildExecution`: End-to-end test verifying workflow `RuntimeEnv` reaches the child agent's `ExecutionContext` through the `agent_call` pipeline
- `TestWorkflowAgentCall_IdempotentSessionReuse`: Verifies workflow recovery does not create duplicate sessions

### Harness Enhancement

Added `ExecutionContextQuery` client to the integration test harness `Clients` struct, enabling tests to verify the contents of child execution contexts.

## Benefits

- Workflow `agent_call` tasks with MCP-dependent agents now work end-to-end
- Workflow recovery no longer fails with `ALREADY_EXISTS` on the `agent_call` task
- Secret env vars are correctly marked in the child execution context
- Integration test coverage prevents regression on this critical data flow path

## Impact

- **Desktop app**: Workflows with agent_call tasks that use MCP servers (e.g., Postgres) now work
- **Cloud production**: Same env forwarding fix benefits cloud workflow executions
- **Workflow recovery**: The Recover button now successfully retries failed agent_call tasks
- **Test suite**: New tests fill two of the largest coverage gaps identified in the integration test inventory

## Related Work

- Unified runner migration (20260518.01)
- CallAgent routing fix and idempotent naming (20260523-132626)
- Workflow execution reliability and error propagation (20260523-141124)

---

**Status**: ✅ Production Ready
