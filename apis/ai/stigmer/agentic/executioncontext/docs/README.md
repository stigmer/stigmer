# ExecutionContext Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` ExecutionContext resource.

## What Is an ExecutionContext?

An ExecutionContext is an **ephemeral, operator-managed collection of runtime configuration and secrets**. It is created by the execution engine at the start of an agent run, holds the values the run's declared keys resolved to, and is deleted when the run completes.

```
conversation's own values + its vaults + (My vault | the surface's vaults)
  ──► [resolve at start] ──► ExecutionContext ──► runner
```

| Resource | Lifecycle | Who creates it | Purpose |
|---|---|---|---|
| **Vault** | Persistent | People and admins | Holds logins (by address) and secrets (by name) that runs use |
| **ExecutionContext** | Ephemeral — tied to one run | Execution engine (operator-only) | Holds the resolved runtime values for a single run; deleted on completion |

ExecutionContexts are not created by end users. They are produced by the Stigmer execution engine when it resolves a run's declared keys from its vaults and its conversation's own values.

## Key Capabilities

- **Ephemeral by design**: an ExecutionContext exists only for the duration of its run — created at start, deleted at completion or failure
- **Tied to one run**: each ExecutionContext carries the `execution_id` of the `Run` it serves
- **Per-conversation secrets**: supports integrator scenarios where secrets are handed to a conversation (`SessionSpec.secrets`) rather than saved in a vault
- **Owner-scoped access, runner-gated secrets**: reads require `can_view` on the ExecutionContext (owner-only; the owner tuple is written at creation). In both editions, secret values are encrypted at rest and redacted on every read for user-class callers; only `getByExecutionId` returns decrypted values, and only to a platform-minted runner credential whose scope binds it to this very run. On cloud that credential is a sandbox token (`token_type` of `sandbox` or `connect_sandbox`; the unscoped `embedded_runner` bootstrap credential is refused and must be exchanged for a scoped token first). On OSS it is the execution-scoped token minted by `PlatformQueryController.getRunnerScopedToken` — a lane discriminator on a single-user server, not a trust boundary
- **Consistent value model**: each entry carries `value` / `is_secret`, keeping the secret-vs-plaintext semantics uniform across the system

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
| `command.proto` | `ExecutionContextCommandController` — apply, create, delete (execution-engine internal) |
| `query.proto` | `ExecutionContextQueryController` — get, getByReference, getByExecutionId (owner `can_view`; decrypted secrets only for runner-class credentials on getByExecutionId) |
| `io.proto` | Input/output messages — `ExecutionContextId`, `ExecutionContextExecutionIdInput` |
