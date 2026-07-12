# ExecutionContext Resource Guide

Complete spec and status schema reference for the `agentic.stigmer.ai/v1` ExecutionContext resource.

For conceptual overview and documentation index, see [README.md](README.md).

---

## Resource Structure

An ExecutionContext follows the standard Stigmer resource pattern:

```
ExecutionContext
├── metadata    — system-managed identity and audit fields
├── spec        — execution_id and runtime key-value data
└── status      — system-managed audit information
```

---

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `ExecutionContext` |
| `metadata` | Yes | Standard API resource metadata |
| `spec` | Yes | ExecutionContext configuration |
| `status` | No | System-managed; never set by users |

---

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name. Typically matches the execution ID or a derived slug. |
| `metadata.slug` | No | URL-friendly identifier. Auto-generated from `name` if omitted. |
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
| `metadata.org` | Depends | Organization that owns this resource. Required in cloud mode. |
| `metadata.labels` | No | Key-value pairs for filtering (e.g., `execution-type: agent`). |
| `metadata.annotations` | No | Key-value pairs for non-filtering metadata. |
| `metadata.tags` | No | String array for categorization. |

ExecutionContexts are operator-managed resources. Their metadata is set by the execution engine, not by end users.

---

## Spec Fields (`ExecutionContextSpec`)

Defined in `ai/stigmer/agentic/executioncontext/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.execution_id` | Yes | The ID of the `AgentExecution` or `WorkflowExecution` this context belongs to. Must be a non-empty string. Used as the primary lookup key by runners via `getByExecutionId`. |
| `spec.data` | No | Map of key-value pairs. Each key is a string (e.g., `"AWS_ACCESS_KEY_ID"`); each value is an `ExecutionValue` message. |

---

## ExecutionValue Fields

Each entry in `spec.data` is an `ExecutionValue`:

| Field | Required | Description |
|---|---|---|
| `value` | Yes | The actual string value. Must be non-empty. If `is_secret: true`, encrypted at rest and redacted in logs. If `is_secret: false`, stored as plaintext and visible in audit logs. |
| `is_secret` | No | When `true`: value is encrypted at rest, redacted in logs, and deleted when the execution completes. When `false`: value is stored as plaintext and visible in audit logs. Defaults to `false`. |

### Secret vs. Non-Secret

| Attribute | `is_secret: false` | `is_secret: true` |
|---|---|---|
| Storage | Plaintext | Encrypted at rest |
| Audit logs | Value visible | Value redacted |
| API reads | Value returned | Value redacted |
| On execution complete | Deleted | Deleted (encrypted form) |
| Use cases | Region names, feature flags, log levels | API tokens, passwords, private keys |

Both secret and non-secret values are deleted when the execution completes — ExecutionContext is ephemeral regardless of `is_secret`.

---

## Status Fields

The `ExecutionContext` status is `ApiResourceAuditStatus` — a standard audit record maintained by the system.

| Field | Description |
|---|---|
| `status.spec_audit` | Audit trail for spec changes: `created_by`, `created_at`, `updated_by`, `updated_at`, last `event` type. |
| `status.status_audit` | Audit trail for system-managed status changes. |

Status is system-managed and must never be set by users.

---

## Authorization Model

ExecutionContexts are owner-scoped: the create pipeline writes an FGA owner tuple for the caller's identity, and reads check `can_view` on the ExecutionContext resource itself (owner-only). Secret access is gated one level deeper, by **caller credential class** — because runners authenticate *as the user who owns the execution*, no permission can tell a runner apart from the user, so the decrypt path keys off the `token_type` claim on platform-minted JWTs instead. OSS enforces no authorization (single-user local).

| Operation | Authorization (cloud) | Notes |
|---|---|---|
| `apply` | delegates to `create` | Create-or-fail — applying over an existing slug returns `AlreadyExists`. |
| `create` | owner tuple written for the caller | Called by the execution engine within the execution create pipeline. |
| `delete` | execution-engine internal | Called when execution completes or is cancelled. |
| `get` | `can_view` on the ExecutionContext | Secret values redacted. |
| `getByReference` | `can_view` on the ExecutionContext | Secret values redacted. |
| `getByExecutionId` | `can_view` on the ExecutionContext | Primary runner lookup. Secret values decrypted **only** for runner-class credentials (`token_type` of `sandbox`, `workflow_sandbox`, `connect_sandbox`, or `embedded_runner`); redacted for every other caller, same as `get`. |

### Why Credential Class, Not a Permission?

ExecutionContexts contain the **merged secrets** a runner needs at execution time, but the runner presents the execution owner's identity (sandbox tokens carry the user as `sub`). Any FGA permission granted so the runner can decrypt would equally be held by the user's own token — so the server distinguishes callers by *what kind of credential* they present, not *who* they are. User-facing reads (console, SDK, API) therefore always see redacted values, matching the `Environment` redaction contract, while platform-minted runner credentials receive usable plaintext.

---

## Lifecycle

```
Execution starts
    │
    ▼
Execution engine resolves environment_refs from AgentInstance/WorkflowInstance
    │
    ▼
Engine merges resolved values (later refs override earlier) + any B2B runtime-injected values
    │
    ▼
Engine calls ExecutionContextCommandController.create(ExecutionContext)
    │  spec.execution_id = <agentExecution.id or workflowExecution.id>
    │  spec.data = merged key-value pairs
    │
    ▼
Runner calls ExecutionContextQueryController.getByExecutionId(execution_id)
    │  receives decrypted values for sandbox injection
    │
    ▼
Agent / workflow logic executes using the injected values
    │
    ▼
Execution completes (success, failure, or cancellation)
    │
    ▼
Execution engine calls ExecutionContextCommandController.delete(executionContext.id)
    └── All values (encrypted and plaintext) are permanently deleted
```

---

## Relationship to Environment

ExecutionContext and Environment solve different problems in the same value-injection pipeline:

| Aspect | Environment | ExecutionContext |
|---|---|---|
| Lifecycle | Persistent | Ephemeral — one execution |
| Created by | Users (via CLI or API) | Execution engine (operator) |
| Reusable | Yes — many instances can reference it | No — 1:1 with one execution |
| Primary key | Resource ID or name | `execution_id` |
| Secret reads | Redacted in all API responses | Decrypted for runner via `getByExecutionId` |
| User-visible | Yes | No |
| Use case | Shared credentials, long-lived config | Runtime injection, B2B scenarios, merged execution context |
