# Organization YAML Schema Reference

Core schema reference for the `tenancy.stigmer.ai/v1` Organization resource. For conceptual overview, see [README.md](README.md).

## Organization YAML Structure

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: My Organization
  slug: my-org
  labels:
    team: platform
  annotations:
    docs-url: "https://internal.example.com/orgs/my-org"
spec:
  description: "Human-readable description of the organization"
  logo_url: "https://example.com/logo.svg"
  parent_org: ""     # set only on a child organization
  external_id: ""    # the parent's identifier for a child
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `tenancy.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `Organization` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | Organization configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name of the organization. |
| `metadata.slug` | No | URL-friendly identifier. Auto-generated from `name` if omitted. Format: lowercase letters, numbers, and hyphens; must start with a lowercase letter; **2–15 characters** (shorter than other resources). |
| `metadata.id` | No | The organization's permanent id (`org_<ulid>`), minted at creation. Every resource the organization owns names it by this id. Never set by users. |
| `metadata.org` | No | Always empty: an organization belongs to no organization. |
| `metadata.labels` | No | Key-value pairs for organization and filtering (e.g., `team: platform`). |
| `metadata.annotations` | No | Key-value pairs for additional metadata not used for filtering (e.g., `docs-url: "https://..."`). |
| `metadata.version` | No | System-managed version tracking. Contains `id`, `message`, and `previous_version_id` for audit trail. Never set directly in YAML. |

### Slug Constraints

Organization slugs have stricter length limits than most other resources:

- Only lowercase letters (`a-z`), numbers (`0-9`), and hyphens (`-`)
- Must start with a lowercase letter
- **2–15 characters** (enforced by `buf.validate`)

```yaml
# Valid slugs
slug: acme
slug: acme-corp
slug: my-org-2

# Invalid slugs
slug: a           # too short (< 2 characters)
slug: this-org-name-is-way-too-long  # too long (> 15 characters)
slug: 1acme       # must start with a letter
slug: acme_corp   # underscores not allowed
```

## Spec Fields

All spec fields are defined by `OrganizationSpec` in `ai/stigmer/tenancy/organization/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.description` | Recommended | Short description of the organization's purpose. Maximum 500 characters. |
| `spec.logo_url` | No | Publicly accessible image URL for UI display. Maximum 2048 characters. |
| `spec.parent_org` | No | The parent organization, by slug or id (stored as the id), for a child organization; empty for one with no parent. The parent may not itself be a child. Creating a child needs `can_manage_child_orgs` on the parent. **Immutable after creation.** Maximum 64 characters. |
| `spec.external_id` | No | The parent's own identifier for this child (a customer id, for example), unique among the parent's children. Requires `parent_org`. **Immutable after creation.** Maximum 256 characters. |

## Parent and Child Organizations

A child organization names its parent in `spec.parent_org`. The parent's admins manage the child: its settings, its members and access, its bill, its deletion. They hold no role in it, so they read none of its agents, sessions or files; to look inside, a parent admin grants themselves a role in the child, which its member list and access history show.

```yaml
spec:
  description: "Acme's workspace, run by Planton"
  parent_org: planton
  external_id: "cust-4411"
```

- Nobody owns a new child: the parent's admins grant its first members and its owner.
- Blueprints the parent shares at `visibility_child_orgs` appear in every child's catalog, children created later included.
- A sign-in through the parent's identity provider whose `external_id_claim` carries `cust-4411` is bound to this child, as is a PlatformClient token the parent mints with `org` naming it.
- One level deep: a child cannot have children, and a parent that still has children cannot be deleted.

## Status Fields

Status is system-managed and must never be set by users in YAML.

| Field | Description |
|---|---|
| `status.audit` | Standard audit information: `spec_audit` and `status_audit`, each containing `created_by`, `created_at`, `updated_by`, `updated_at`, and the last `event` type. |

## CLI Commands

```bash
# Create a new organization
stigmer org create org.yaml

# Apply (create or update) an organization from a YAML file
stigmer org apply org.yaml

# Validate without applying
stigmer org apply org.yaml --dry-run

# List organizations you are a member of
stigmer org list

# Get organization details (table format)
stigmer org get my-org

# Get organization details as YAML
stigmer org get my-org --output yaml

# Update an existing organization
stigmer org update org.yaml

# Delete an organization
# Warning: irreversible; its slug is released for anyone to take
stigmer org delete my-org
```

## API Operations

| Operation | Authorization | Description |
|---|---|---|
| `create` | Any authenticated user; `can_manage_child_orgs` on the parent for a child | Creates a new organization. Its creator becomes its owner, except for a child organization, which nobody owns. |
| `apply` | Caller determined at runtime | Create or update, authorization resolved per operation. |
| `update` | Organization admin, or the parent's admin (`can_edit`) | Updates an existing organization. |
| `rename` | Organization owner, or the parent's admin (`can_delete`) | Changes the slug. The id, and everything filed under it, stays; the old slug leads to the organization for 30 days. |
| `delete` | Organization owner, or the parent's admin (`can_delete`) | Deletes the organization and every access grant on it. Its slug is released. Refused while it has child organizations. |
| `get` | Organization member, or the parent's admin (`can_view_settings`) | Gets a single organization by ID. |
| `list` | Platform admin | Paginated list of all organizations (admin only). |
| `findMyOrganizations` | Any authenticated user | Returns organizations the caller is a member of. |
| `getByExternalId` | The parent's admin (`can_manage_child_orgs` on `parent_org`) | Finds a child organization by its parent and external id. |
| `listChildOrgs` | The parent's admin (`can_manage_child_orgs` on `org`) | Lists an organization's child organizations, newest first, paged. |

## Related Documentation

- [README.md](README.md) — Overview, parent and child organizations, and CLI quick reference
- [examples.md](examples.md) — Complete YAML examples, from minimal to a child organization
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist and common pitfalls
