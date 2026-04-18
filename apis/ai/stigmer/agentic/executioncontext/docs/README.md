# ExecutionContext Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` ExecutionContext resource.

## What Is an ExecutionContext?

An ExecutionContext is an **ephemeral, operator-managed collection of runtime configuration and secrets**. It is created by the execution engine at the start of a workflow or agent execution, holds the merged key-value pairs the runner needs during that execution, and is deleted when the execution completes.

```
AgentInstance (environment_refs) ──► [merge at start] ──► ExecutionContext ──► AgentExecution runner
WorkflowInstance (environment_refs) ──────────────────────────────────────────► WorkflowExecution runner
```

| Resource | Lifecycle | Who creates it | Purpose |
|---|---|---|---|
| **Environment** | Persistent | Users | Stores named key-value pairs shared across many instances and executions |
| **ExecutionContext** | Ephemeral — tied to one execution | Execution engine (operator-only) | Holds the resolved, merged runtime secrets for a single execution; deleted on completion |

ExecutionContexts are not created by end users. They are produced by the Stigmer execution engine when it resolves and merges all referenced Environments (and any B2B runtime-injected secrets) for a specific execution run.

## Key Capabilities

- **Ephemeral by design**: an ExecutionContext exists only for the duration of its execution — created at start, deleted at completion or failure
- **Tied to one execution**: each ExecutionContext carries the `execution_id` of the `AgentExecution` or `WorkflowExecution` it serves
- **Runtime secret injection**: supports B2B scenarios (e.g., Planton integrations) where secrets are injected at execution time rather than stored in a persistent Environment
- **Operator-only access**: all read and write operations require platform-level operator permission — only internal runners can retrieve decrypted values
- **Consistent value model**: each entry uses the same `value` / `is_secret` pattern as `EnvironmentValue`, keeping the secret-vs-plaintext semantics uniform across the system

## Documentation Index

| Document | Description |
|---|---|
| [execution-context-resource-guide.md](execution-context-resource-guide.md) | Complete spec and status schema reference — all fields, types, and authorization model |
| [examples.md](examples.md) | Example ExecutionContext payloads covering B2B injection, mixed secrets, and runner lookup patterns |

## Proto Source

All types in this package are defined in `ai/stigmer/agentic/executioncontext/v1/`:

| File | Contents |
|---|---|
| `api.proto` | `ExecutionContext`, top-level resource message |
| `spec.proto` | `ExecutionContextSpec` — `execution_id`, `data`; `ExecutionValue` — `value`, `is_secret` |
| `command.proto` | `ExecutionContextCommandController` — apply, create, delete (all operator-only) |
| `query.proto` | `ExecutionContextQueryController` — get, getByReference, getByExecutionId (all operator-only) |
| `io.proto` | Input/output messages — `ExecutionContextId`, `ExecutionContextExecutionIdInput` |
