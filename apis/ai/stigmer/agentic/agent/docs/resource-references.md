# ApiResourceReference Format

When an Agent references another resource (MCP server, skill), it uses the `ApiResourceReference` message defined in `ai/stigmer/commons/apiresource/io.proto`. This document is the single source of truth for that format.

## YAML Format

```yaml
org: local
kind: skill
slug: code-review-best-practices
version: stable
```

## Fields

| Field | Required | Format | Description |
|---|---|---|---|
| `org` | Yes | `^[a-z][a-z0-9-]*$`, 1-63 chars | Organization that owns the referenced resource. |
| `kind` | Yes | Lowercase string enum name | Resource kind. See [Kind Values](#kind-values). |
| `slug` | Yes | `^[a-z][a-z0-9-]*$`, 1-63 chars | Resource slug, unique within the organization. |
| `version` | No | Tag, hash, or empty | Version pin. Only applicable to versioned resources (Skills). Ignored for non-versioned resources. |

## Kind Values

The `kind` field uses the **lowercase string name** of the `ApiResourceKind` enum. In YAML, always use the string form — never the integer.

| YAML Value | Enum Integer | Resource Type |
|---|---|---|
| `skill` | 43 | Skill — reusable knowledge package |
| `mcp_server` | 44 | MCP Server — external tool provider |

**Important:** The proto enum uses integer values internally (e.g., `this.kind == 43` in CEL validation expressions). In YAML serialization, the YAML parser accepts the **lowercase string name**. Always use `kind: skill` or `kind: mcp_server` in YAML files.

```yaml
# Correct
kind: skill
kind: mcp_server

# Wrong — do not use integers in YAML
kind: 43
kind: 44

# Wrong — do not capitalize
kind: Skill
kind: MCP_SERVER
```

## Organization (`org`)

The `org` field identifies which organization owns the referenced resource. It is always required.

### Local Mode

In local mode (CLI single-tenant), bootstrapped system resources use `org: local`. This is the default org for all resources in local mode.

```yaml
# Referencing a system-bootstrapped skill in local mode
org: local
kind: skill
slug: code-review-best-practices
```

### Cloud Mode

In cloud mode, `org` is the actual organization identifier. Resources are scoped to their owning organization.

```yaml
# Referencing a skill from your own org
org: acme-corp
kind: skill
slug: internal-style-guide

# Referencing a public skill from another org
org: stigmer
kind: skill
slug: code-analysis
```

### Canonical Format

References are canonically represented as `org/slug` (e.g., `stigmer/web-search`, `acme-corp/data-analyst`). This format appears in logs, the UI, and API responses.

## Slug

Slugs are user-friendly identifiers that are unique within an organization. Format constraints:

- Lowercase alphanumeric characters and hyphens only
- Must start with a letter
- 1-63 characters long

```yaml
# Correct
slug: code-reviewer
slug: github
slug: my-deployment-tool-v2

# Wrong
slug: Code_Reviewer    # uppercase and underscores
slug: codeReviewer     # camelCase
slug: 2nd-reviewer     # starts with digit
```

## Version Pinning (Skills Only)

The `version` field is only meaningful for versioned resources. Currently, only Skills are versioned. For non-versioned resources (MCP servers, agents), the field is ignored.

| Value | Behavior |
|---|---|
| Empty or omitted | Resolves to the latest version |
| `latest` | Explicitly resolves to the latest version (same as empty) |
| Tag name (e.g., `stable`, `v1.0`) | Resolves to the version tagged with this name |
| 64-character hex hash (e.g., `abc123...`) | Immutable reference to an exact version by content hash |

```yaml
# Use latest version (implicit)
skill_refs:
  - org: local
    kind: skill
    slug: code-review-best-practices

# Pin to a named tag
skill_refs:
  - org: local
    kind: skill
    slug: code-review-best-practices
    version: stable

# Pin to an exact content hash (immutable)
skill_refs:
  - org: local
    kind: skill
    slug: code-review-best-practices
    version: "a1b2c3d4e5f6..."
```

Tags are mutable pointers — `stable` may point to different content over time. Content hashes are immutable — they always resolve to the exact same version. Use tags for flexibility, hashes for reproducibility.

## Validation Rules

The proto enforces these constraints via `buf.validate`:

- `org`: required, matches `^[a-z][a-z0-9-]*$`, 1-63 chars
- `slug`: required, matches `^[a-z][a-z0-9-]*$`, 1-63 chars
- `version`: optional, matches `^$|^latest$|^[a-zA-Z0-9._-]+$|^[a-f0-9]{64}$`
- `kind`: required, must be a defined `ApiResourceKind` enum value

Additional CEL validation on Agent fields:

- `mcp_server_usages[*].mcp_server_ref.kind` must equal `mcp_server` (enum value 44)
- `skill_refs[*].kind` must equal `skill` (enum value 43)
