# AgentInstance Resource Guide

Complete spec and status schema reference for the `agentic.stigmer.ai/v1` AgentInstance resource.

For conceptual overview and documentation index, see [README.md](README.md).

---

## Resource Structure

An AgentInstance follows the standard Stigmer resource pattern:

```
AgentInstance
├── metadata    — system-managed identity and audit fields
├── spec        — user-provided configuration (agent binding + environment refs)
└── status      — system-managed audit information
```

---

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `AgentInstance` |
| `metadata` | Yes | Standard API resource metadata |
| `spec` | Yes | Instance configuration |
| `status` | No | System-managed; never set by users |

---

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name for the instance. Example: `"github-prod-instance"`. |
| `metadata.slug` | No | URL-friendly identifier. Auto-generated from `name` if omitted. Lowercase alphanumeric with hyphens, starts with a letter, 1–63 characters. |
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
| `metadata.org` | Depends | Organization that owns this instance. Required in cloud mode. In local mode, defaults to `local`. |
| `metadata.labels` | No | Key-value pairs for filtering and organization (e.g., `env: production`). |
| `metadata.annotations` | No | Key-value pairs for non-filtering metadata (e.g., `owner: platform-team`). |
| `metadata.tags` | No | String array for categorization and search. |

### Scope

AgentInstances can be scoped to a platform, organization, or identity account. Scope is determined by the metadata fields provided at creation time:

| Scope | Description | Use case |
|---|---|---|
| Organization | Instance belongs to an org. Accessible to all org members with `can_view` permission. | Shared team credentials for a GitHub or Jira bot. |
| Identity account | Instance belongs to a specific user. Isolated from other org members. | Personal API keys or per-user OAuth tokens. |
| Platform | Global instance accessible across all orgs. | System-level or marketplace-published agents. |

---

## Spec Fields (`AgentInstanceSpec`)

Defined in `ai/stigmer/agentic/agentinstance/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.agent_id` | Yes | The ID of the Agent template this instance deploys. Min length: 1. Validated by `buf.validate`. |
| `spec.description` | No | Human-readable description of this instance. Example: `"Production GitHub bot for main repo"`. Useful for distinguishing multiple instances of the same agent. |
| `spec.environment_refs` | No | References to one or more Environment resources. Merged in order at execution time — later entries override earlier ones. See [environment-binding.md](environment-binding.md). |

---

## Environment References (`ApiResourceReference`)

Each entry in `spec.environment_refs` is an `ApiResourceReference`. All entries must reference resources with `kind = environment` (enforced by `buf.validate`).

| Field | Description |
|---|---|
| `kind` | Must be `52` (the enum value for `environment`). Validated automatically. |
| `id` | ID of the Environment resource. |
| `name` | Human-readable name for display. Optional. |
| `org` | Organization that owns the Environment. |

Environments are resolved at execution start. If an environment cannot be resolved (e.g., it was deleted or the instance lacks access), the execution create fails with a resolution error.

---

## Status Fields

The `AgentInstance` status is `ApiResourceAuditStatus` — a standard audit record maintained by the system.

| Field | Description |
|---|---|
| `status.spec_audit` | Audit trail for spec changes: `created_by`, `created_at`, `updated_by`, `updated_at`, last `event` type. |
| `status.status_audit` | Audit trail for system-managed status changes. |

Status is system-managed and must never be set by users.

---

## Authorization Model

AgentInstance uses Fine-Grained Authorization (FGA) for all operations.

| Operation | Permission Required | Notes |
|---|---|---|
| `create` | `can_create_instance` on the parent Agent | Checked via FGA contextual tuples. For org-scoped creation, the `agent#organization@organization:target-org` tuple is passed to FGA in a single authorization check. |
| `update` | `can_edit` on the instance | Standard resource-level permission. |
| `delete` | `can_delete` on the instance | Only the owner or an org admin can delete. |
| `get` | `can_view` on the instance | Standard resource-level permission. |
| `getByAgent` | Handled in handler | FGA query returns authorized `agent_instance_ids`, then filtered by `agent_id`. Users only see instances they have access to, even if the parent agent is shared. |

---

## CLI Commands

### Creating and Managing Instances

```bash
# Apply (create or update) an instance from a YAML file
stigmer agent instance apply instance.yaml

# Create an instance
stigmer agent instance create --agent my-github-agent --env github-prod-env --name "GitHub Production"

# Update an instance (full state replacement — always provide complete spec)
stigmer agent instance update instance.yaml

# Delete an instance
stigmer agent instance delete inst_abc123
```

### Inspecting Instances

```bash
# Get a single instance by ID or name
stigmer agent instance get inst_abc123

# Get instance details as YAML
stigmer agent instance get inst_abc123 --output yaml

# List all instances for a specific agent
stigmer agent instance list --agent my-github-agent

# List instances for an agent in a specific org
stigmer agent instance list --agent my-github-agent --org acme-corp
```

### Using Instances at Runtime

```bash
# Run an agent using a specific named instance
stigmer run my-github-agent "Review the latest PR" --instance inst_abc123

# Run using the default instance (auto-created, no configuration needed)
stigmer run my-github-agent "Review the latest PR"
```
