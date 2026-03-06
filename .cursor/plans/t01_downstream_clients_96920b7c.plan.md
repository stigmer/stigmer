---
name: T01 Downstream Clients
overview: Implement two new downstream gRPC clients (Environment query, ExecutionContext command) following the exact established pattern from 7 existing clients in `pkg/downstream/`.
todos:
  - id: env-client
    content: Create `backend/services/stigmer-server/pkg/downstream/environment/client.go` with GetByReference method, following the established downstream client pattern
    status: completed
  - id: ec-client
    content: Create `backend/services/stigmer-server/pkg/downstream/executioncontext/client.go` with Create and Delete methods, following the mcpserver delete pattern for ApiResourceDeleteInput
    status: completed
  - id: verify-build
    content: Run `go build ./backend/services/stigmer-server/...` to verify both clients compile cleanly
    status: completed
isProject: false
---

# T01: Create Downstream Clients (Environment + ExecutionContext)

## Domain Analysis (Architect Role)

These clients are **infrastructure adapters** -- thin gRPC wrappers that live outside their respective domains. They carry no domain logic and should not. The domain logic (environment merging, lifecycle orchestration) belongs in T02's `CreateExecutionContextStep`. These clients are the plumbing that step will call through.

The T01 plan is architecturally sound:

- **Environment client**: query-only (we never mutate environments from the execution domain) -- follows Interface Segregation
- **ExecutionContext client**: command-only (query operations are used by agent-runner, a separate service) -- same principle
- **No existing files are modified** -- pure additive change

No concerns to raise. The plan aligns with the established patterns.

## Reference Pattern

The closest analog for each client:

- **Environment client** (query-only): follows the shape of [session/client.go](backend/services/stigmer-server/pkg/downstream/session/client.go) (single-purpose, minimal surface) but with a query client instead of a command client
- **ExecutionContext client** (command with `ApiResourceDeleteInput`-based delete): follows [mcpserver/client.go](backend/services/stigmer-server/pkg/downstream/mcpserver/client.go) exactly for the `Delete` method pattern

All 7 existing clients share the same skeleton:

- Struct with `conn *grpc.ClientConn` + one or more gRPC stub clients
- `NewClient(conn *grpc.ClientConn) *Client` constructor
- `log.Debug()` before call, `log.Error().Err(err)` on failure, `log.Debug()`/`log.Info()` on success
- `Close() error` that nil-checks `conn` before closing
- Architecture Note doc comment on the struct

## Files to Create

### 1. `backend/services/stigmer-server/pkg/downstream/environment/client.go`

**Package**: `environment`

**Struct**:

```go
type Client struct {
    conn        *grpc.ClientConn
    queryClient environmentv1.EnvironmentQueryControllerClient
}
```

**Imports**:

- `context`
- `github.com/rs/zerolog/log`
- `environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"`
- `"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"`
- `"google.golang.org/grpc"`

**Methods**:

- `NewClient(conn *grpc.ClientConn) *Client` -- creates `environmentv1.NewEnvironmentQueryControllerClient(conn)`
- `GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*environmentv1.Environment, error)` -- calls `queryClient.GetByReference(ctx, ref)`, logs org/slug on entry, error on failure, id/name on success
- `Close() error` -- standard pattern

### 2. `backend/services/stigmer-server/pkg/downstream/executioncontext/client.go`

**Package**: `executioncontext`

**Struct**:

```go
type Client struct {
    conn      *grpc.ClientConn
    cmdClient executioncontextv1.ExecutionContextCommandControllerClient
}
```

**Imports**:

- `context`
- `github.com/rs/zerolog/log`
- `executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"`
- `"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"`
- `"google.golang.org/grpc"`

**Methods**:

- `NewClient(conn *grpc.ClientConn) *Client` -- creates `executioncontextv1.NewExecutionContextCommandControllerClient(conn)`
- `Create(ctx context.Context, ec *executioncontextv1.ExecutionContext) (*executioncontextv1.ExecutionContext, error)` -- calls `cmdClient.Create(ctx, ec)`, logs execution_id on entry, error on failure, id on success
- `Delete(ctx context.Context, resourceID string) (*executioncontextv1.ExecutionContext, error)` -- constructs `&apiresource.ApiResourceDeleteInput{ResourceId: resourceID}` and calls `cmdClient.Delete(ctx, input)` (same pattern as [mcpserver/client.go lines 132-154](backend/services/stigmer-server/pkg/downstream/mcpserver/client.go))
- `Close() error` -- standard pattern

## Verified Preconditions

- Generated Go stubs exist at `apis/stubs/go/ai/stigmer/agentic/environment/v1/` (7 .go files including `query_grpc.pb.go`)
- Generated Go stubs exist at `apis/stubs/go/ai/stigmer/agentic/executioncontext/v1/` (7 .go files including `command_grpc.pb.go`)
- `EnvironmentQueryControllerClient` interface confirmed: `Get(ctx, *ApiResourceId) (*Environment, error)`, `GetByReference(ctx, *ApiResourceReference) (*Environment, error)`
- `ExecutionContextCommandControllerClient` interface confirmed: `Apply(ctx, *ExecutionContext) (*ExecutionContext, error)`, `Create(ctx, *ExecutionContext) (*ExecutionContext, error)`, `Delete(ctx, *ApiResourceDeleteInput) (*ExecutionContext, error)`

## What This Does NOT Touch

- No existing files modified
- No server wiring (that's T02)
- No pipeline steps, workflow changes, or cleanup activities (T02-T04)

## Validation

After creating both files: `go build ./backend/services/stigmer-server/...` to confirm compilation.