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
  management_mode: self_managed
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
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
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
| `spec.management_mode` | No | How the organization is operated. `self_managed` (default) or `platform_managed`. **Immutable after creation.** |
| `spec.identity_provider_ref` | Conditional | Reference to the IdentityProvider that authenticates requests. **Required when `management_mode` is `platform_managed`; must be empty for `self_managed`.** Immutable after creation. |
| `spec.external_org_id` | No | External platform's organization identifier for reverse mapping. Set only for `platform_managed` organizations. Allows the integrating platform to look up the corresponding Stigmer org by its own org ID. |

## Management Mode

`management_mode` is the most consequential spec field. It determines who controls the organization and cannot be changed after creation.

### `self_managed` (Default)

The user creates and operates the organization directly via the Stigmer UI, CLI, or API. Members are invited manually.

```yaml
spec:
  description: "Acme engineering organization"
  management_mode: self_managed
```

### `platform_managed`

The organization is created programmatically by an external platform via an IdentityProvider. The platform authenticates and manages users on behalf of the organization. When `platform_managed`, `identity_provider_ref` is required.

```yaml
spec:
  description: "Acme org managed by Planton"
  management_mode: platform_managed
  identity_provider_ref:
    org: stigmer
    kind: identity_provider
    slug: planton-idp
  external_org_id: "planton-org-12345"
```

The `external_org_id` enables the integrating platform to reverse-lookup the Stigmer organization by its own identifier, even if the Stigmer slug differs due to name availability constraints.

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
# Warning: cascades to all resources under the organization
stigmer org delete my-org
```

## API Operations

| Operation | Authorization | Description |
|---|---|---|
| `create` | Any authenticated user | Creates a new organization. Creator automatically becomes owner. |
| `apply` | Caller determined at runtime | Create or update, authorization resolved per operation. |
| `update` | Organization admin (`can_edit`) | Updates an existing organization. |
| `delete` | Organization owner (`can_delete`) | Deletes the organization and all its resources. |
| `get` | Organization member (`can_view`) | Gets a single organization by ID. |
| `list` | Platform admin | Paginated list of all organizations (admin only). |
| `findMyOrganizations` | Any authenticated user | Returns organizations the caller is a member of. |
| `getByExternalOrgId` | IdentityProvider `can_view` | Looks up a `platform_managed` org by external platform coordinates. |

## Related Documentation

- [README.md](README.md) — Overview, management modes, and CLI quick reference
- [examples.md](examples.md) — Complete YAML examples from minimal to platform-managed
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist and common pitfalls
