# Environment Resource Guide

Complete spec and status schema reference for the `agentic.stigmer.ai/v1` Environment resource.

For conceptual overview and documentation index, see [README.md](README.md).

---

## Resource Structure

An Environment follows the standard Stigmer resource pattern:

```
Environment
├── metadata    — system-managed identity and audit fields
├── spec        — user-provided configuration (description + key-value data)
└── status      — system-managed audit information
```

---

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `Environment` |
| `metadata` | Yes | Standard API resource metadata |
| `spec` | Yes | Environment configuration |
| `status` | No | System-managed; never set by users |

---

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name for the environment. Example: `"github-prod-secrets"`. |
| `metadata.slug` | No | URL-friendly identifier. Auto-generated from `name` if omitted. Lowercase alphanumeric with hyphens, starts with a letter, 1–63 characters. |
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
| `metadata.org` | Depends | Organization that owns this environment. Required in cloud mode. In local mode, defaults to `local`. |
| `metadata.labels` | No | Key-value pairs for filtering and organization (e.g., `env: production`). |
| `metadata.annotations` | No | Key-value pairs for non-filtering metadata (e.g., `owner: platform-team`). |
| `metadata.tags` | No | String array for categorization and search. |

### Visibility

Environments are typically created with `PRIVATE` visibility — accessible only to members of the owning organization who have been granted `can_view` permission. This ensures that secret values are never exposed to unauthorized callers, even if they can discover the environment's name or ID.

---

## Spec Fields (`EnvironmentSpec`)

Defined in `ai/stigmer/agentic/environment/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.description` | No | Human-readable description of this environment. Example: `"Production AWS credentials for the deployment pipeline"`. |
| `spec.data` | No | Map of key-value pairs. Each key is a string (e.g., `"GITHUB_TOKEN"`); each value is an `EnvironmentValue` message. |

---

## EnvironmentValue Fields

Each entry in `spec.data` is an `EnvironmentValue`:

| Field | Required | Description |
|---|---|---|
| `value` | No | The actual string value. If `is_secret: true`, this is encrypted at rest and redacted in logs. Can be empty when pre-declaring keys whose values will be injected at runtime. |
| `is_secret` | No | When `true`: value is encrypted at rest, redacted in logs, and requires special permissions to read. When `false`: value is stored as plaintext and visible in audit logs. Defaults to `false`. |
| `description` | No | Per-value documentation string. Example: `"AWS access key for S3 bucket access"`. |

### Secret vs. Non-Secret

| Attribute | `is_secret: false` | `is_secret: true` |
|---|---|---|
| Storage | Plaintext | Encrypted at rest |
| Audit logs | Value visible | Value redacted |
| API reads | Value returned | Value redacted |
| Use cases | Feature flags, region names, log levels | API tokens, passwords, private keys |

---

## Status Fields

The `Environment` status is `ApiResourceAuditStatus` — a standard audit record maintained by the system.

| Field | Description |
|---|---|
| `status.spec_audit` | Audit trail for spec changes: `created_by`, `created_at`, `updated_by`, `updated_at`, last `event` type. |
| `status.status_audit` | Audit trail for system-managed status changes. |

Status is system-managed and must never be set by users.

---

## Authorization Model

Environment uses Fine-Grained Authorization (FGA) for all operations.

| Operation | Permission Required | Notes |
|---|---|---|
| `create` | `can_create_environment` on the parent org | Environments are org-scoped resources. |
| `update` | `can_edit` on the environment | Full state replacement — always provide the complete spec. |
| `delete` | `can_edit` on the environment | Deleting an environment referenced by an active AgentInstance will cause future executions using that instance to fail. |
| `get` | `can_view` on the environment | Secret values are never returned in `get` responses — only keys and non-secret values. |
| `getByReference` | Handled in handler | Resolves an environment by `ApiResourceReference`. Used internally by the execution runner. |

---

## CLI Commands

### Creating and Managing Environments

```bash
# Apply (create or update) an environment from a YAML file
stigmer environment apply env.yaml

# Create an environment
stigmer environment create --name "github-prod-secrets" --org acme-corp

# Update an environment (full state replacement — always provide complete spec)
stigmer environment update env.yaml

# Delete an environment
stigmer environment delete env_abc123
```

### Inspecting Environments

```bash
# Get a single environment by ID or name
stigmer environment get env_abc123

# Get environment details as YAML
stigmer environment get env_abc123 --output yaml

# List all environments in an org
stigmer environment list --org acme-corp
```

### Notes on Secret Values

Secret values (`is_secret: true`) are **never returned** in CLI output or API responses. The `get` command shows keys and non-secret values only. To rotate a secret, `update` the environment with the new value — the change takes effect on the next execution that references the environment, with no changes required to any AgentInstance.
