# What is an Execution Context?

## One-Sentence Positioning

**An ExecutionContext is a short-lived, merged secret bundle that the execution engine creates when a run starts and destroys when it ends — the same way a process's in-memory environment variables exist only for the lifetime of that process.**

---

## Executive Summary

An ExecutionContext is Stigmer's runtime secret carrier. When an AgentExecution or WorkflowExecution starts, the execution engine resolves every Environment referenced by the bound AgentInstance, merges them in order, combines them with any runtime-injected values (for B2B scenarios), and stores the result as an ExecutionContext. Runners retrieve it via a single lookup, receive decrypted secrets, and inject them into the agent sandbox. When the execution ends, the ExecutionContext is deleted.

ExecutionContext is not a user-facing resource. It is created, managed, and deleted entirely by the execution engine.

```
Environment A ──┐
Environment B ──┤ merge ──► ExecutionContext ──► runner sandbox ──► AgentExecution
Runtime secrets ┘                  │
                                   └── deleted on execution end
```

Two properties distinguish ExecutionContext from a persistent Environment:

1. **Ephemeral**: ExecutionContext exists only for the duration of one execution. It is not shared, not reused, and not visible to users after the run completes.
2. **Decrypted for runners**: The `getByExecutionId` lookup — available only to platform-level operator callers — returns plaintext secret values. All other API paths, including persistent Environment reads, redact secrets.

---

## The Problem ExecutionContext Solves

### Runners Need One Merged Map, Not Multiple Environment Lookups

An AgentInstance can reference several Environments in an ordered list:

```yaml
environment_refs:
  - name: global-defaults
  - name: platform-team-config
  - name: production-secrets
```

Without a merged resolution step, a runner would need to fetch each Environment separately, apply override semantics in the correct order, and handle merge conflicts — reimplementing the same logic in every runner (Go, Python, future runtimes). Worse, each fetch would be a separate round-trip, and any failure mid-merge would leave secrets in a partially-resolved state.

ExecutionContext is the solution: the execution engine does the merge once, stores the result, and gives the runner a single endpoint — `getByExecutionId` — that returns the complete, merged, decrypted map in one call.

### B2B Runtime Secret Injection

Persistent Environments work well when secrets are known in advance and stored in Stigmer. But in B2B integrations — for example, a calling platform like Planton Cloud orchestrating agents on behalf of its own customers — secrets are often provided at call time and must not persist beyond that execution.

There is no good place to put these in the persistent model:

- Hardcoding them in an Environment means they persist long after the execution ends.
- Injecting them directly into the AgentExecution spec exposes them in the execution record indefinitely.

ExecutionContext is the right home: the calling platform injects secrets at execution start, they live only in the ExecutionContext for the duration of the run, and they are gone when the run completes — with no persistent artifact containing plaintext credentials.

---

## The ExecutionContext Resource

ExecutionContext follows the standard Stigmer resource pattern. Users do not create or read these directly — the execution engine manages them on behalf of every execution.

### The Spec: What the Engine Stores

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-abc123
  org: acme-corp
spec:
  # The AgentExecution or WorkflowExecution ID this context belongs to.
  # Used as the primary lookup key by runners.
  execution_id: "aex_abc123"

  # Merged key-value pairs. Engine populates this from resolved Environments
  # and any runtime-injected values.
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
    AWS_REGION:
      value: "us-east-1"
      is_secret: false
    AWS_ACCESS_KEY_ID:
      value: "AKIAIOSFODNN7EXAMPLE"
      is_secret: true
    LOG_LEVEL:
      value: "info"
      is_secret: false
```

**Spec fields at a glance:**

| Field | Required | Description |
|---|---|---|
| `execution_id` | Yes | The ID of the `AgentExecution` or `WorkflowExecution` this context serves. Must be non-empty. |
| `data` | No | Map of string keys to `ExecutionValue` messages. |

### ExecutionValue: The Core Unit

Each entry in `data` is an `ExecutionValue`:

| Field | Required | Description |
|---|---|---|
| `value` | Yes | The actual string value. Must be non-empty. Encrypted at rest when `is_secret: true`. |
| `is_secret` | No | When `true`: encrypted at rest, redacted in logs, deleted on execution end. When `false`: stored as plaintext, visible in audit output. Defaults to `false`. |

Unlike `EnvironmentValue`, `ExecutionValue` does not carry a per-value `description`. ExecutionContexts are ephemeral engine artifacts — documentation belongs on the source Environments, not the runtime merge result.

### The Status: What the System Manages

```yaml
status:
  spec_audit:
    created_by: "system"
    created_at: "2026-02-28T10:00:00Z"
    updated_by: "system"
    updated_at: "2026-02-28T10:00:00Z"
    event: CREATE
```

Status is system-managed and must never be set by users.

---

## Lifecycle

ExecutionContext lifecycle is always coupled to its execution:

```
Execution starts
    │
    ▼
Engine resolves environment_refs from AgentInstance / WorkflowInstance
    │
    ▼
Engine merges resolved values in order (later refs override earlier)
Engine adds any B2B runtime-injected values
    │
    ▼
Engine calls ExecutionContextCommandController.create(...)
    │  spec.execution_id = <agentExecution.id or workflowExecution.id>
    │  spec.data = merged, encrypted key-value map
    │
    ▼
Runner calls ExecutionContextQueryController.getByExecutionId(execution_id)
    │  Returns the complete, decrypted map in one call
    │
    ▼
Secrets are injected into the agent sandbox — execution proceeds
    │
    ▼
Execution ends (completed, failed, cancelled, or terminated)
    │
    ▼
Engine calls ExecutionContextCommandController.delete(executionContext.id)
    └── All values — encrypted and plaintext — are permanently deleted
```

The ExecutionContext is always deleted when execution ends, regardless of how the execution ends. There is no retained copy of the decrypted values.

---

## How Runners Use ExecutionContext

Runners look up the ExecutionContext for their execution using the execution ID injected into their process at startup. The `getByExecutionId` call is the only operation in the system that returns **decrypted** secret values:

```
# Pseudocode: what the agent runner does at startup

execution_id = env("STIGMER_EXECUTION_ID")

ctx = ExecutionContextQueryController.getByExecutionId({
    execution_id: execution_id
})

for key, exec_value in ctx.spec.data:
    os.environ[key] = exec_value.value   # already decrypted by the server
```

All other query paths (`get`, `getByReference`) are available only to operator callers as well, but return redacted values. The `getByExecutionId` path is the singular point where decryption is surfaced — locked behind platform-level operator authorization to ensure that only internal runner processes can read it.

---

## ExecutionContext vs. Environment

| Aspect | Environment | ExecutionContext |
|---|---|---|
| Lifecycle | Persistent | Ephemeral — one execution |
| Created by | Users (CLI / API) | Execution engine (operator) |
| Deleted by | Users explicitly | Execution engine on completion |
| Scope | Shared across many instances and executions | 1:1 with a single execution |
| Primary key | Resource ID or name | `execution_id` |
| Secret reads | Redacted in all API responses | Decrypted for runner via `getByExecutionId` |
| User-visible | Yes | No |
| B2B runtime injection | Not designed for it | Primary use case |
| Contains `description` per value | Yes | No |
| Use case | Shared credentials, long-lived config | Merged runtime context, short-lived credentials |

The two resources solve adjacent but distinct problems. Environments are the *source of truth* for credentials. ExecutionContext is the *runtime materialization* of those credentials for a specific run.

---

## What You See as a User

Although users cannot directly read ExecutionContext values, AgentExecution exposes what was available at runtime through `status.resolved_context`:

```yaml
status:
  resolved_context:
    # Keys only — values are never included
    environment_keys:
      - GITHUB_TOKEN
      - AWS_REGION
      - AWS_ACCESS_KEY_ID
      - LOG_LEVEL

    # MCP servers resolved using those credentials
    mcp_servers:
      github-mcp:
        resolved: true
        enabled_tool_count: 5
        message: "Configured successfully"
```

This field is populated from the ExecutionContext at execution start and captures exactly which environment keys were injected into the agent sandbox. It provides full audit visibility without ever exposing secret values.

---

## How It Compares

| Without ExecutionContext | With ExecutionContext |
|---|---|
| Runners must fetch and merge multiple Environments independently — reimplementing merge logic in each runtime | Engine merges once; runner calls `getByExecutionId` and receives the complete map |
| B2B runtime-injected secrets have no clean home — they persist in execution records or require workaround solutions | Secrets live only in ExecutionContext for the duration of the run, then are deleted |
| Decrypted secrets must be returned by general-purpose APIs or stored in the execution record | Decryption is confined to a single, operator-only endpoint accessible only by runners |
| A partial merge failure mid-execution leaves the runner working from incomplete credentials | Engine creates the complete ExecutionContext before the runner starts — it either exists in full or the execution fails before the runner begins |
| No single source of truth for what the runner actually received | Keys recorded in `status.resolved_context.environment_keys` at execution start |

---

## Further Reading

- [What is an Environment?](./what-is-environment.md) — The persistent, user-managed credential store that ExecutionContext resolves and merges
- [What is an Agent Instance?](./what-is-agent-instance.md) — Where `environment_refs` is declared, linking Environments into the execution pipeline
- [What is an Agent Execution?](./what-is-agent-execution.md) — The execution record that triggers ExecutionContext creation
- [ExecutionContext Resource Guide](../../apis/ai/stigmer/agentic/executioncontext/docs/execution-context-resource-guide.md) — Complete spec, status, authorization model, and lifecycle
- [ExecutionContext Examples](../../apis/ai/stigmer/agentic/executioncontext/docs/examples.md) — Example payloads: B2B injection, merged environments, workflow execution contexts
- [How to Provide Secrets](./how-to-provide-secrets.md) — Choosing between the Environment Flow (persistent) and the Execution Flow (ephemeral)
