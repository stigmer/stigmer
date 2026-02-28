# WorkflowInstance API Resource Reference

Schema reference for the `agentic.stigmer.ai/v1` WorkflowInstance resource. For conceptual overview and the Template→Instance→Execution pattern, see [README.md](README.md).

## WorkflowInstance Resource Shape

A WorkflowInstance resource as returned by `stigmer get workflow-instance <ref> --output yaml`:

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  id: wfi_01abc123def456789
  name: prod-deploy
  slug: prod-deploy
  org: acme-corp
  visibility: visibility_private
spec:
  workflow_id: wfl_01xyz789
  description: "Production CI/CD pipeline for main branch — targets AWS us-east-1"
  env_refs:
    - slug: base-config
    - slug: aws-prod-env
    - slug: github-main-token
status:
  audit:
    created_by: usr_abc123
    created_at: "2026-01-15T10:30:00Z"
    updated_by: usr_abc123
    updated_at: "2026-01-20T14:00:00Z"
    version: 3
```

## Top-Level Fields

| Field | Set By | Value |
|---|---|---|
| `api_version` | Author | Always `agentic.stigmer.ai/v1` |
| `kind` | Author | Always `WorkflowInstance` |
| `metadata` | Author + system | See below |
| `spec` | Author | See below |
| `status` | System-managed | See below |

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Description |
|---|---|
| `metadata.id` | System-generated unique identifier. Format: `wfi_<ulid>`. Set by the platform on create; ignored if included in author YAML. |
| `metadata.name` | Canonical display name. Set by the author. Used in the UI and CLI listings. |
| `metadata.slug` | URL-friendly identifier, unique within the organization. Derived from `metadata.name` if not explicitly set. Reference format: `org/slug` (e.g., `acme-corp/prod-deploy`). |
| `metadata.org` | Organization that owns this instance. Provided via `--org` flag or CLI context. Every instance belongs to exactly one organization. |
| `metadata.visibility` | Access control. `visibility_private` (default): only org members can access. `visibility_public`: anyone can read and reference. |
| `metadata.labels` | Key-value pairs for organization and filtering. |
| `metadata.tags` | String array for categorization and discoverability. |

### Visibility

```yaml
# Private instance (default) — only your org can access and execute it
metadata:
  visibility: visibility_private

# Public instance — visible to and referenceable by everyone
metadata:
  visibility: visibility_public
```

## Spec Fields

`WorkflowInstanceSpec` is defined in `ai/stigmer/agentic/workflowinstance/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.workflow_id` | Yes | Resource ID of the Workflow template this instance deploys. Format: `wfl_<ulid>`. The referenced Workflow must exist and be valid before the instance can be executed. |
| `spec.description` | No | Human-readable summary documenting purpose, target environment, team ownership, or configuration notes. |
| `spec.env_refs` | No | Ordered list of Environment resource references. Environments are merged in declaration order — later entries override earlier ones on key conflicts. |

### workflow_id

`spec.workflow_id` links this instance to its Workflow template. The ID is immutable after creation — to change which workflow an instance targets, delete the instance and create a new one.

```yaml
spec:
  workflow_id: wfl_01abc123def456789
```

Use `stigmer get workflow <slug> --output yaml | grep "^  id:"` to retrieve the workflow's ID.

### env_refs

`spec.env_refs` is an ordered list of `ApiResourceReference` entries. Each reference can use `id` or `slug` to point to an Environment resource.

```yaml
spec:
  env_refs:
    - slug: base-config          # by slug
    - slug: aws-prod-env         # by slug — overrides any base-config keys that conflict
    - id: env_01xyz789abc        # by resource ID
```

**Layering behavior**: environments are merged left-to-right. The rightmost environment wins when the same key appears in multiple environments.

```
base-config:       DB_HOST=db.internal, TIMEOUT=30
aws-prod-env:      DB_HOST=db.prod.aws.com, AWS_REGION=us-east-1

Resolved:          DB_HOST=db.prod.aws.com   ← aws-prod-env wins
                   TIMEOUT=30                ← base-config (no conflict)
                   AWS_REGION=us-east-1      ← aws-prod-env only
```

**Empty env_refs**: valid. The workflow runs with only the values the workflow template declares as optional with defaults, or with no environment at all (useful for stateless workflows or testing).

## Status Fields

`WorkflowInstance` uses `ApiResourceAuditStatus` — a simple status containing only audit information. There is no custom execution state on the instance itself; execution state is tracked in `WorkflowExecution` resources.

| Field | Description |
|---|---|
| `status.audit.created_by` | User ID of the creator. |
| `status.audit.created_at` | ISO 8601 timestamp of creation. |
| `status.audit.updated_by` | User ID of the last updater. |
| `status.audit.updated_at` | ISO 8601 timestamp of the last update. |
| `status.audit.version` | Monotonically incrementing version number. Starts at 1 on create; incremented on every update. |

## What Can Be Updated

| Field | Mutable | Notes |
|---|---|---|
| `spec.workflow_id` | No | Immutable after creation. Delete and recreate to change. |
| `spec.description` | Yes | Update at any time. |
| `spec.env_refs` | Yes | Add, remove, or reorder environment references. Takes effect on the next execution. |
| `metadata.labels` | Yes | — |
| `metadata.tags` | Yes | — |
| `metadata.id` | No | Immutable resource identifier. |
| `metadata.org` | No | Immutable after creation. |

## CLI Commands

All workflow instance operations use `stigmer <verb> workflow-instance` — not `stigmer workflow-instance <verb>`.

```bash
# Apply a workflow instance (create or update)
stigmer apply workflow-instance.yaml

# Apply from a specific file path
stigmer apply ./instances/prod-deploy.yaml

# Apply to a specific organization
stigmer apply workflow-instance.yaml --org acme-corp

# Preview what would be applied without making changes
stigmer apply workflow-instance.yaml --dry-run

# Get a workflow instance by slug, org/slug, or resource ID
stigmer get workflow-instance prod-deploy
stigmer get workflow-instance acme-corp/prod-deploy
stigmer get workflow-instance wfi_01abc123

# Get as YAML or JSON
stigmer get workflow-instance prod-deploy --output yaml
stigmer get workflow-instance prod-deploy --output json

# List all instances in the current org
stigmer list workflow-instances

# List with a limit
stigmer list workflow-instances --limit 20

# List from a specific org
stigmer list workflow-instances --org acme-corp

# Delete a workflow instance
stigmer delete workflow-instance prod-deploy
stigmer delete workflow-instance prod-deploy --force  # skip confirmation
```

### Apply Flags Reference

| Flag | Default | Description |
|---|---|---|
| `--org <org>` | CLI context | Organization to apply into. |
| `--dry-run` | `false` | Validate the YAML and preview changes without applying. |
| `--force` | `false` | Skip confirmation prompts for destructive operations. |

### Delete Behavior

Deleting a WorkflowInstance:
- **Does not** delete the referenced Workflow template (templates are reusable).
- **Does not** delete the referenced Environment resources (environments are reusable).
- **Does** cascade-delete any dependent WorkflowExecution resources (executions belong to the instance).

## Related Documentation

- [README.md](README.md) — Overview, Template→Instance→Execution pattern, and table of contents
- [examples.md](examples.md) — Complete workflow instance YAML examples
- [../workflow/docs/workflow-resource-guide.md](../workflow/docs/workflow-resource-guide.md) — Workflow template resource reference
