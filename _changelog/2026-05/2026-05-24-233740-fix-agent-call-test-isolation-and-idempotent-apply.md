# Fix Agent Call Test Isolation and Idempotent Default Instance Apply

**Date**: May 24, 2026

## Summary

Fixed 3 integration test failures (Category 3: ExecutionContext Not Found + Test Isolation) by scoping child execution queries to their parent workflow and making the `CreateDefaultInstance` pipeline step idempotent via Apply semantics. Changes span both the OSS Go backend and the Cloud Java service.

## Problem Statement

Three tests in `workflow_agent_call_env_forwarding_test.go` were failing due to two independent root causes:

### Pain Points

- `findChildAgentExecution` helper returned the **first** agent execution with any `parent_workflow_id`, picking up stale executions from prior test runs
- `CreateDefaultInstance` step used hard `Create` (not `Apply`), so an orphaned default instance from a prior agent deletion caused `ALREADY_EXISTS` failures
- Agent `Delete` does not cascade to its default instance, leaving orphaned `{slug}-default` instances in the store

## Solution

1. **Scoped child execution queries** — `findChildAgentExecution` now accepts the workflow execution ID and matches on the exact Temporal child workflow ID convention (`workflow-exec-{id}`)
2. **Idempotent default instance creation** — Switched from `Create` to `Apply` for the default instance, so orphaned instances are recovered (updated with the new agent ID) rather than causing failures
3. **Test isolation** — Each test now uses a unique agent slug suffix to prevent cross-test contamination

## Implementation Details

### Test Helper Fix (OSS)

- `findChildAgentExecution` accepts `workflowExecutionID` parameter
- Filters by `parent_workflow_id == "workflow-exec-" + workflowExecutionID` (Strategy C — exact match)
- `createEnvForwardingTestAgent` accepts a `suffix` parameter for per-test unique naming

### Backend Fix (OSS Go + Cloud Java)

- Added `ApplyAsSystem` / `applyAsCaller` methods to the `AgentInstanceGrpcRepo` downstream client
- `CreateDefaultInstance` step now calls `Apply` instead of `Create`
- Apply semantics: if instance exists (orphaned), update its `agent_id`; if not, create it

### Files Changed

| Repo | File | Change |
|------|------|--------|
| stigmer | `test/integration/workflow_agent_call_env_forwarding_test.go` | Scoped query + unique slugs |
| stigmer | `backend/.../agent/controller/create.go` | ApplyAsSystem for default instance |
| stigmer | `backend/.../downstream/agentinstance/client.go` | Added ApplyAsSystem method |
| stigmer-cloud | `backend/.../agent/request/handler/AgentCreateHandler.java` | applyAsCaller for default instance |
| stigmer-cloud | `backend/.../agentinstance/AgentInstanceGrpcRepo.java` | Added applyAsCaller interface |
| stigmer-cloud | `backend/.../agentinstance/AgentInstanceGrpcRepoImpl.java` | Implemented applyAsCaller |

## Benefits

- 3 flaky/failing integration tests now pass consistently
- Agent Apply is truly idempotent end-to-end (including default instance lifecycle)
- Test suite is more robust against cross-test contamination from prior runs
- Establishes the pattern for handling orphaned child resources during declarative apply

## Impact

- Integration test reliability improved (16 failures → 13 remaining from other categories)
- Production correctness: repeated `stigmer apply -f agent.yaml` no longer fails if an orphaned default instance exists
- No proto changes, no migration needed

## Related Work

- Category 1 (FGA model missing `artifact` type) — separate fix needed in stigmer-cloud FGA model
- Category 2 (agent_call execution failures) — upstream issue that caused the stale executions; these test fixes make Category 3 independent of Category 2

---

**Status**: Production Ready
**Timeline**: ~1 hour
