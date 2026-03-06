# ExecutionContext Lifecycle: Downstream Clients (T01)

**Date**: March 7, 2026

## Summary

Created two new downstream gRPC clients -- Environment (query) and ExecutionContext (command) -- as the foundation for the ExecutionContext lifecycle feature. These infrastructure adapters enable the execution engine to resolve environment references and manage ephemeral ExecutionContext resources, paving the way for removing secrets from Temporal workflow history.

## Problem Statement

The current agent execution flow passes the full `AgentExecution` proto (including `runtime_env` with secrets) directly into the Temporal workflow input. This means secrets are persisted in Temporal's workflow history, which is a security concern. The fix requires creating an `ExecutionContext` resource server-side with the fully-merged environment, passing only a slim reference through Temporal, and cleaning up the `ExecutionContext` when the execution completes.

### Pain Points

- Secrets visible in Temporal workflow history
- No server-side environment merging (agent defaults + environment_refs + runtime_env)
- No lifecycle management for ephemeral execution configuration

## Solution

As the first task (T01) in a 4-task project, created the two downstream gRPC clients that all subsequent tasks depend on:

1. **Environment client** (query-only) -- resolves `AgentInstance.environment_refs` to full `Environment` resources so their data can be merged into the `ExecutionContext`
2. **ExecutionContext client** (command-only) -- creates and deletes `ExecutionContext` resources for lifecycle management

These are pure infrastructure with zero side effects on existing behavior.

## Implementation Details

Both clients follow the exact established pattern from 7 existing downstream clients in `pkg/downstream/`:

- **Environment client** (`downstream/environment/client.go`): Exposes `GetByReference(ctx, *ApiResourceReference) (*Environment, error)`. Uses `EnvironmentQueryControllerClient` for in-process gRPC. Follows the session client shape (single-purpose, minimal surface).

- **ExecutionContext client** (`downstream/executioncontext/client.go`): Exposes `Create(ctx, *ExecutionContext) (*ExecutionContext, error)` and `Delete(ctx, resourceID string) (*ExecutionContext, error)`. Uses `ExecutionContextCommandControllerClient` for in-process gRPC. The `Delete` method constructs `ApiResourceDeleteInput` from the resource ID, following the mcpserver client pattern.

Both include the standard `NewClient(conn)` constructor, `Close()` lifecycle method, zerolog-based logging (Debug before call, Error on failure, Debug/Info on success), and Architecture Note documentation.

## Benefits

- Clean dependency chain for subsequent tasks (T02-T04)
- Interface Segregation: Environment client is query-only (execution domain never mutates environments), ExecutionContext client is command-only (query operations are used by agent-runner directly)
- Zero risk: pure additive change, no existing files modified
- Validated: `go build ./backend/services/stigmer-server/...` compiles cleanly

## Impact

- **Backend team**: New foundation for ExecutionContext lifecycle (T02-T04)
- **Security**: Enables the path to removing secrets from Temporal workflow history
- **Architecture**: Extends the established downstream client pattern to two new domains

## Related Work

- Project: `20260307.01.execution-context-lifecycle`
- Next: T02 (CreateExecutionContextStep), T03 (slim workflow input), T04 (cleanup activity)
- Depends on: ExecutionContext controller (already implemented), Environment controller (already implemented)

---

**Status**: Production Ready
**Timeline**: T01 of 4-task project
