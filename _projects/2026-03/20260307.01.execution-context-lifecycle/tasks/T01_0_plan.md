# Task T01: Create Downstream Clients (Environment + ExecutionContext)

**Created**: 2026-03-07
**Status**: COMPLETED
**Type**: Foundation / Infrastructure

## Objective

Create two new downstream gRPC clients that the CreateExecutionContextStep (T02) will depend on:
1. **Environment client** -- read environments by reference (for merging env layers)
2. **ExecutionContext client** -- create and delete ExecutionContext resources (for lifecycle management)

These follow the exact same pattern as the existing downstream clients (`agent`, `agentinstance`, `session`, etc.) in `backend/services/stigmer-server/pkg/downstream/`.

## Why This Is T01

These clients are pure infrastructure with zero side effects on existing behavior. They establish the foundation that T02 (CreateExecutionContextStep), T03 (slim workflow input), and T04 (cleanup activity) all depend on. Building them first ensures a clean dependency chain and lets us validate the gRPC wiring in isolation.

## Scope

### 1. Environment downstream client

**File**: `backend/services/stigmer-server/pkg/downstream/environment/client.go`

**Pattern**: Follows `backend/services/stigmer-server/pkg/downstream/agent/client.go` exactly.

**Methods needed** (only what the CreateExecutionContextStep will use):
- `GetByReference(ctx, ref *ApiResourceReference) (*Environment, error)` -- loads a single Environment by its org+kind+slug reference. Used to resolve each entry in `AgentInstance.environment_refs`.

**Proto RPCs available** (from `environment/v1/query.proto`):
- `EnvironmentQueryController.get(ApiResourceId) -> Environment`
- `EnvironmentQueryController.getByReference(ApiResourceReference) -> Environment`

**Struct**:
```go
type Client struct {
    conn        *grpc.ClientConn
    queryClient environmentv1.EnvironmentQueryControllerClient
}
```

Only the query client is needed -- the agentexecution domain never creates or modifies environments.

### 2. ExecutionContext downstream client

**File**: `backend/services/stigmer-server/pkg/downstream/executioncontext/client.go`

**Pattern**: Same downstream client pattern.

**Methods needed**:
- `Create(ctx, ec *ExecutionContext) (*ExecutionContext, error)` -- creates an ExecutionContext (called during agent execution creation)
- `Delete(ctx, resourceID string) (*ExecutionContext, error)` -- deletes an ExecutionContext (called during workflow cleanup)

**Proto RPCs available** (from `executioncontext/v1/command.proto`):
- `ExecutionContextCommandController.create(ExecutionContext) -> ExecutionContext`
- `ExecutionContextCommandController.delete(ApiResourceDeleteInput) -> ExecutionContext`

**Struct**:
```go
type Client struct {
    conn      *grpc.ClientConn
    cmdClient executioncontextv1.ExecutionContextCommandControllerClient
}
```

Only the command client is needed -- query operations (getByExecutionId) are used by the Python agent-runner directly, not by stigmer-server.

## Reference Files

- Pattern to follow: `backend/services/stigmer-server/pkg/downstream/agent/client.go`
- Environment proto: `apis/ai/stigmer/agentic/environment/v1/query.proto`
- ExecutionContext proto: `apis/ai/stigmer/agentic/executioncontext/v1/command.proto`
- ApiResourceReference proto: `apis/ai/stigmer/commons/apiresource/io.proto`
- ApiResourceDeleteInput proto: `apis/ai/stigmer/commons/apiresource/io.proto`

## Out of Scope

- Server wiring (connecting these clients to the in-process gRPC server) -- handled in T02 alongside the pipeline step
- The CreateExecutionContextStep itself -- T02
- Workflow changes -- T03
- Cleanup activity -- T04

## Success Criteria

- Both clients compile and follow the established downstream client pattern
- Each method has proper logging (zerolog) matching the style of existing clients
- Each client has a `Close()` method for connection cleanup
- No changes to any existing files in this task

## Files Created

| File | Description |
|------|-------------|
| `backend/services/stigmer-server/pkg/downstream/environment/client.go` | Environment query client (GetByReference) |
| `backend/services/stigmer-server/pkg/downstream/executioncontext/client.go` | ExecutionContext command client (Create, Delete) |
