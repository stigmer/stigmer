# Project YAML Schema Reference

Core schema reference for the `tenancy.stigmer.ai/v1` Project resource. For conceptual overview and the apply workflow, see [README.md](README.md).

## Project YAML Structure

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Project
metadata:
  name: my-agent-fleet
  org: acme-corp
  labels:
    team: platform
  tags:
    - production
    - agent-fleet
spec:
  description: "Production agent fleet for the platform team"
  entry_point: main.go   # omit for declarative track
  # members is never written by users — the CLI populates it
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `tenancy.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `Project` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | Project configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name of the project (e.g., `"Platform Agent Fleet"`). |
| `metadata.slug` | No | URL-friendly identifier, unique within the organization. Auto-generated from `name` if omitted. Format: lowercase alphanumeric with hyphens, starts with a letter, 1–63 characters. |
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
| `metadata.org` | Depends | Organization that owns this project. **Local mode:** defaults to `local` if omitted. **Cloud mode:** required, enforced by the Authorization Service. |
| `metadata.labels` | No | Key-value pairs for filtering and organization. |
| `metadata.annotations` | No | Key-value pairs for additional metadata not used for filtering. |
| `metadata.tags` | No | String array for categorization and search. |
| `metadata.version` | No | System-managed version tracking. Never set directly in YAML. |

## Spec Fields

All spec fields are defined by `ProjectSpec` in `ai/stigmer/tenancy/project/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.entry_point` | No | Path to the SDK entry-point file. When set, the project uses the SDK track. When absent, the project uses the declarative track. See [sdk-track.md](sdk-track.md). |
| `spec.description` | Recommended | Human-readable explanation of what this project groups. |
| `spec.members` | Never | Populated by the CLI after applying individual resources. **Never write this field in YAML.** The server uses it for orphan pruning. |

### Track Selection

The `entry_point` field determines which authoring track the project uses:

```yaml
# Declarative track — scan directory for YAML resource files
spec:
  description: "My agent fleet"
  # entry_point absent

# SDK track — execute entry_point to synthesize resources
spec:
  description: "My agent fleet"
  entry_point: main.go
```

See [declarative-track.md](declarative-track.md) and [sdk-track.md](sdk-track.md) for the complete workflow for each track.

### The `members` Field

`spec.members` is a `repeated ApiResourceReference` — a list of `org/kind/slug` identifiers pointing to the resources this project manages. It is populated by the CLI as a side-effect of applying individual resources. It must never be written by users.

```yaml
# This is what the CLI sends to the server after applying resources.
# You will never write this yourself.
spec:
  members:
    - org: acme-corp
      kind: agent
      slug: code-reviewer
    - org: acme-corp
      kind: agent
      slug: deployment-assistant
    - org: acme-corp
      kind: mcp_server
      slug: github
```

The server computes orphans as `previous_members − current_members` and deletes any resource that appeared in the previous apply but is absent from the current one.

## Status Fields

Status is system-managed and must never be set by users in YAML.

| Field | Description |
|---|---|
| `status.last_reconciliation` | Reconciliation summary from the most recent Apply. Populated only in the Apply() response — not persisted to the database. Shows created, updated, and deleted resources. |
| `status.audit` | Standard audit trail: `created_by`, `created_at`, `updated_by`, `updated_at`. The `updated_at` field indicates when the project was last successfully applied. |

### Reconciliation Summary

The `last_reconciliation` field is returned in the Apply response to show what changed:

| Field | Description |
|---|---|
| `last_reconciliation.created` | Resources applied for the first time during this project apply. |
| `last_reconciliation.updated` | Resources that already existed and were updated. |
| `last_reconciliation.deleted` | Resources pruned as orphans — they were in the previous membership list but absent from the current one. |

Example CLI output from a project apply:

```
Applied project "my-agent-fleet":
  Members: 3 agents, 1 workflow, 2 mcp_servers
  Pruned:  1 agent (removed from project)
```

## CLI Commands

```bash
# Apply (create or update) a project from a YAML file
stigmer project apply stigmer.yaml

# Validate without applying
stigmer project apply stigmer.yaml --dry-run

# List all projects
stigmer project list

# List projects from a specific organization
stigmer project list --org acme-corp

# Get project details (table format)
stigmer project get my-agent-fleet

# Get project details as YAML (includes status and member list)
stigmer project get my-agent-fleet --output yaml

# Delete a project (does not delete member resources)
stigmer project delete my-agent-fleet
```

> **Note:** Deleting a project removes the project resource itself but does not delete the member resources it tracked. To delete member resources, delete them individually or remove them from the project and apply (triggering orphan pruning).

## Related Documentation

- [README.md](README.md) — Overview, apply workflow, and table of contents
- [declarative-track.md](declarative-track.md) — Directory layout and declarative apply workflow
- [sdk-track.md](sdk-track.md) — Entry-point execution and SDK runtime inference
- [examples.md](examples.md) — Complete YAML examples
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist and common pitfalls
