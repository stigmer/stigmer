# ApiResourceReference Format

When an Agent references another resource (MCP server, skill), it uses the `ApiResourceReference` message defined in `ai/stigmer/commons/apiresource/io.proto`. This document is the single source of truth for that format.

## YAML Format

```yaml
kind: skill
slug: code-review-best-practices
version: stable
```

## Fields

| Field | Required | Format | Description |
|---|---|---|---|
| `org` | No | `^$\|^[a-z][a-z0-9-]*$`, 0-63 chars | Organization that owns the referenced resource. Empty = relative reference (resolved from the parent resource's `metadata.org` at write time). |
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

The `org` field identifies which organization owns the referenced resource. It supports two modes:

### Relative References (Recommended)

Omit the `org` field to create a relative reference. The server resolves the organization from the parent resource's `metadata.org` at write time. This makes YAML portable across organizations.

```yaml
# Relative — org resolved from the agent's metadata.org
skill_refs:
  - kind: skill
    slug: code-review-best-practices
```

### Absolute References

Set `org` explicitly when referencing resources in a different organization — typically public marketplace resources published by another org.

```yaml
# Absolute — referencing a public skill from another org
skill_refs:
  - org: stigmer
    kind: skill
    slug: code-analysis

# Absolute — referencing a resource in your own org (explicit)
skill_refs:
  - org: acme-corp
    kind: skill
    slug: internal-style-guide
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
  - kind: skill
    slug: code-review-best-practices

# Pin to a named tag
skill_refs:
  - kind: skill
    slug: code-review-best-practices
    version: stable

# Pin to an exact content hash (immutable)
skill_refs:
  - kind: skill
    slug: code-review-best-practices
    version: "a1b2c3d4e5f6..."
```

Tags are mutable pointers — `stable` may point to different content over time. Content hashes are immutable — they always resolve to the exact same version. Use tags for flexibility, hashes for reproducibility.

## Validation Rules

The proto enforces these constraints via `buf.validate`:

- `org`: optional, matches `^$|^[a-z][a-z0-9-]*$` (empty string allowed for relative references)
- `slug`: required, matches `^[a-z][a-z0-9-]*$`, 1-63 chars
- `version`: optional, matches `^$|^latest$|^[a-zA-Z0-9._-]+$|^[a-f0-9]{64}$`
- `kind`: required, must be a defined `ApiResourceKind` enum value

Additional CEL validation on Agent fields:

- `mcp_server_usages[*].mcp_server_ref.kind` must equal `mcp_server` (enum value 44)
- `skill_refs[*].kind` must equal `skill` (enum value 43)
