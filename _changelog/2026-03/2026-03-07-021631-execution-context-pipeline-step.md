# ExecutionContext Pipeline Step for AgentExecution and WorkflowExecution

**Date**: March 7, 2026

## Summary

Added a `CreateExecutionContext` pipeline step to both the AgentExecution and WorkflowExecution creation flows. Each step resolves the full environment dependency chain for its domain, merges three layers of environment configuration into a single `ExecutionContext`, and persists it via the downstream gRPC client. A shared pure-function merge utility in `backend/libs/go/envmerge/` keeps the merge logic DRY and independently testable.

## Problem Statement

Agent and workflow executions need a fully-merged environment at runtime -- combining template defaults, instance-level environment references, and execution-time overrides. Previously, this merging did not happen server-side, and secrets were passed directly through the Temporal workflow input, exposing them in workflow history.

### Pain Points

- No server-side mechanism to build a merged environment before execution starts
- Secrets would flow into Temporal workflow history via the execution proto
- No reusable utility for the three-layer environment merge pattern
- Downstream clients for session, agentinstance, and workflowinstance lacked `Get` methods needed for the resolution chain

## Solution

Introduced a `CreateExecutionContext` pipeline step that runs during execution creation (after initial phase is set, before persistence). Each domain has its own step file with a domain-specific resolution chain, while sharing a common merge utility.

## Implementation Details

### Shared merge utility (`backend/libs/go/envmerge/merge.go`)

Pure function `MergeEnvironmentLayers` that takes three layers and returns a merged `map[string]*ExecutionValue`:

1. **Template defaults** (`Agent.spec.env_spec.data` / `Workflow.spec.env_spec.data`) -- lowest priority
2. **Instance environments** (resolved from `AgentInstance.environment_refs` / `WorkflowInstance.env_refs`) -- overrides template
3. **Runtime overrides** (`AgentExecution.spec.runtime_env` / `WorkflowExecution.spec.runtime_env`) -- highest priority

Empty `EnvironmentValue.value` entries are filtered during conversion to `ExecutionValue` (which requires `min_len=1`).

### AgentExecution step

Resolution chain: pipeline context or session lookup -> AgentInstance -> Agent -> environment references -> merge -> persist ExecutionContext.

### WorkflowExecution step

Resolution chain: execution spec -> WorkflowInstance (via downstream client) -> Workflow (via store) -> environment references -> merge -> persist ExecutionContext.

### Downstream client extensions

- `session/client.go`: added `queryClient` field and `Get(ctx, id)` method
- `agentinstance/client.go`: added `Get(ctx, id)` method
- `workflowinstance/client.go`: added `queryClient` field and `Get(ctx, id)` method

### Server wiring

Created `environmentClient` and `executionContextClient` in `server.go` and injected them into both the `AgentExecutionController` and `WorkflowExecutionController`.

## Benefits

- **Security**: ExecutionContext is created server-side with merged secrets; Temporal workflow input can be stripped of sensitive data (T03)
- **Consistency**: Both AgentExecution and WorkflowExecution follow the same three-layer merge contract
- **Reusability**: `envmerge.MergeEnvironmentLayers` is a pure function usable by any future domain that needs environment merging
- **Testability**: Merge logic is separated from I/O; each step's resolution chain is isolated in its own file
- **Clean architecture**: Each domain's step respects its existing data access patterns (AE via gRPC clients, WE via store for same-service resources)

## Impact

- **AgentExecution creation pipeline**: New step at position 8 (after SetInitialPhase, before ProcessAttachments)
- **WorkflowExecution creation pipeline**: New step at position 9 (after SetInitialPhase, before Persist)
- **No proto changes**: All work uses existing proto definitions
- **No breaking changes**: Pipeline steps are additive; existing flows continue to work

## Related Work

- **T01**: Created Environment and ExecutionContext downstream clients (prerequisite, committed in `4c55d93`)
- **T03 (next)**: Slim Workflow Input -- strip runtime_env from persisted execution, send only slim input to Temporal
- **T04 (upcoming)**: Cleanup Activity -- delete ExecutionContext on workflow completion

---

**Status**: Production Ready
**Timeline**: ~2 hours (T02 planning + implementation)
