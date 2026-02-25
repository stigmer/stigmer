# Agent YAML Validation Reference

Complete validation checklist and common-pitfall catalogue for
`agentic.stigmer.ai/v1` Agent resources.

## Table of Contents

1. [Pre-flight Checklist](#1-pre-flight-checklist)
2. [Top-Level Field Validation](#2-top-level-field-validation)
3. [Metadata Validation](#3-metadata-validation)
4. [Spec Validation](#4-spec-validation)
5. [MCP Server Usage Validation](#5-mcp-server-usage-validation)
6. [Skill Ref Validation](#6-skill-ref-validation)
7. [Sub-Agent Validation](#7-sub-agent-validation)
8. [Environment Spec Validation](#8-environment-spec-validation)
9. [Common Pitfalls (with fixes)](#9-common-pitfalls-with-fixes)
10. [CLI Validation Commands](#10-cli-validation-commands)

---

## 1. Pre-flight Checklist

Before presenting any Agent YAML, confirm every item below:

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1` (no trailing slash, correct casing)
- [ ] `kind` is exactly `Agent` (capital A, no other text)
- [ ] `metadata.name` is present and non-empty
- [ ] `spec.description` is present and explains what the agent does
- [ ] `spec.instructions` is ≥ 10 characters and provides meaningful behavioral guidance
- [ ] All `mcp_server_usages` slugs were verified via Stigmer MCP tools (`search` or `get_mcp_server`)
- [ ] All `skill_refs` slugs were verified via Stigmer MCP tools (`search` or `get_skill`)
- [ ] All `mcp_server_ref` entries have `kind: mcp_server`
- [ ] All `skill_refs` entries have `kind: skill`
- [ ] No duplicate slugs exist within `mcp_server_usages`
- [ ] No duplicate names exist within `sub_agents`
- [ ] Every sub-agent `mcp_access[].mcp_server` references a slug present in the parent's `mcp_server_usages`
- [ ] Every sub-agent `enabled_tools` list is a subset of the parent's `enabled_tools` for that server
- [ ] Every sub-agent `instructions` is ≥ 10 characters
- [ ] All slugs (metadata and resource refs) follow the slug format (lowercase, hyphens, starts with letter, ≤63 chars)
- [ ] YAML is syntactically valid (correct indentation, no duplicate keys, proper quoting)
- [ ] `status` field is absent (system-managed — never authored)

---

## 2. Top-Level Field Validation

### `apiVersion`

Proto constraint: `string.const = 'agentic.stigmer.ai/v1'`

| Value | Valid? | Reason |
|---|---|---|
| `agentic.stigmer.ai/v1` | ✓ | Exact match |
| `agentic.stigmer.ai/v2` | ✗ | Wrong version |
| `Agentic.stigmer.ai/v1` | ✗ | Wrong casing |
| `agentic.stigmer.ai/v1/` | ✗ | Trailing slash |

### `kind`

Proto constraint: `string.const = 'Agent'`

| Value | Valid? |
|---|---|
| `Agent` | ✓ |
| `agent` | ✗ |
| `AGENT` | ✗ |
| `McpServer` | ✗ |

---

## 3. Metadata Validation

### `metadata.name`
- Required. Must be non-empty.
- Human-readable — no format restrictions.

### `metadata.slug`
- Optional (auto-generated from name if omitted).
- Pattern: `^[a-z][a-z0-9-]*$`, max 63 characters.
- Must start with a lowercase letter.
- Only lowercase letters, digits, and hyphens.

| Value | Valid? | Reason |
|---|---|---|
| `my-agent` | ✓ | |
| `agent123` | ✓ | |
| `a` | ✓ | Single char allowed |
| `My-Agent` | ✗ | Uppercase |
| `my_agent` | ✗ | Underscore |
| `123-agent` | ✗ | Starts with digit |
| `-agent` | ✗ | Starts with hyphen |
| `agent-` | ✗ | Trailing hyphen |
| 64+ characters | ✗ | Exceeds 63-char limit |

---

## 4. Spec Validation

### `spec.description`
- No proto constraint but strongly required by convention.
- Should be 1–2 sentences, clearly describing what the agent does.
- Used in the UI, marketplace, and sub-agent delegation decisions.

### `spec.instructions`
- Proto constraint: `string.min_len = 10`
- A 10-character minimum is enforced. Strive for meaningful guidance.

| Value | Valid? |
|---|---|
| `You are a helpful assistant that answers questions clearly.` | ✓ |
| `Assistant` | ✗ (9 chars) |
| `"Helper"` | ✗ (6 chars) |

---

## 5. MCP Server Usage Validation

### `mcp_server_ref.kind`

Proto constraint: `this.mcp_server_ref.kind == 44` (i.e., the `kind` field string value must be `mcp_server`).

| Value | Valid? |
|---|---|
| `kind: mcp_server` | ✓ |
| `kind: McpServer` | ✗ |
| `kind: skill` | ✗ |
| `kind: 44` | ✗ (use string, not number) |

### Slug uniqueness within `mcp_server_usages`

Each `mcp_server_ref.slug` must be unique within the list.

```yaml
# ✗ INVALID — duplicate slug
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github   # duplicate!

# ✓ VALID
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: kubernetes
```

### `enabled_tools`

- Tool names are **case-sensitive** and must exactly match what the MCP server reports via `tools/list`.
- Always verify tool names by calling `get_mcp_server` before authoring.
- Empty list = use `McpServer.default_enabled_tools` (or all tools if not set by the McpServer).

### `tool_approval_overrides[].tool_name`

- Proto constraint: `min_len: 1`
- Invalid tool names are silently ignored at runtime (forward-compatibility).
- Best practice: verify tool names via `get_mcp_server` to catch typos early.

---

## 6. Skill Ref Validation

### `skill_refs[].kind`

Proto constraint: `this.kind == 43` (string value must be `skill`).

| Value | Valid? |
|---|---|
| `kind: skill` | ✓ |
| `kind: Skill` | ✗ |
| `kind: SKILL` | ✗ |
| `kind: 43` | ✗ (use string) |

### All required fields

Every `skill_refs` entry must have all three of:

```yaml
# ✓ VALID
skill_refs:
  - org: local
    kind: skill
    slug: code-review-guide

# ✗ INVALID — missing kind and slug
skill_refs:
  - org: local
```

### `version` field (optional)

```yaml
# Pin to a tag:
- org: local
  kind: skill
  slug: my-skill
  version: stable

# Pin to content hash (immutable):
- org: local
  kind: skill
  slug: my-skill
  version: sha256:abc123...

# Latest (omit version):
- org: local
  kind: skill
  slug: my-skill
```

---

## 7. Sub-Agent Validation

### Unique names

Sub-agent `name` must be unique within the `sub_agents` list.

```yaml
# ✗ INVALID — duplicate name
sub_agents:
  - name: reviewer
    instructions: "Review code quality."
  - name: reviewer    # duplicate!
    instructions: "Review security issues."
```

### `instructions` minimum length

Each sub-agent's `instructions` must be ≥ 10 characters (same proto constraint as the parent).

### `mcp_access[].mcp_server` must reference parent slug

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github

  sub_agents:
    - name: helper
      instructions: "You help with code tasks."
      mcp_access:
        - mcp_server: github     # ✓ matches parent slug
          enabled_tools: [search_code]

        - mcp_server: slack      # ✗ slack not in parent's mcp_server_usages
```

### `enabled_tools` must be a subset of parent's tools

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr

  sub_agents:
    - name: reader
      instructions: "Read-only code access."
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code   # ✓ in parent's list
            - get_file      # ✓ in parent's list
            - delete_repo   # ✗ NOT in parent's list — invalid
```

### Sub-agent `skill_refs` are independent

Sub-agents may reference any skill, regardless of what the parent agent references.

```yaml
sub_agents:
  - name: specialist
    instructions: "Domain specialist."
    skill_refs:
      - org: local
        kind: skill
        slug: any-skill-slug    # ✓ fully independent from parent
```

---

## 8. Environment Spec Validation

- Variable names are arbitrary strings (uppercase by strong convention).
- `is_secret: true` causes the value to be encrypted at rest and redacted in logs.
- Leave `value` empty in the spec — actual values are provided via `AgentInstance`.

```yaml
# ✓ VALID
env_spec:
  data:
    GITHUB_TOKEN:
      description: "GitHub PAT with repo scope"
      is_secret: true
    API_BASE_URL:
      description: "Base URL for the internal API"
      is_secret: false
```

---

## 9. Common Pitfalls (with fixes)

### Uppercase or underscores in slugs

```yaml
# ✗
metadata:
  slug: Code_Reviewer

# ✓
metadata:
  slug: code-reviewer
```

### Wrong casing on kind values in references

```yaml
# ✗
skill_refs:
  - kind: Skill

# ✓
skill_refs:
  - kind: skill
```

### Instructions too short

```yaml
# ✗ (8 chars)
spec:
  instructions: "Helper."

# ✓
spec:
  instructions: "You are a helpful assistant that answers user questions."
```

### Duplicate MCP server slugs

```yaml
# ✗
mcp_server_usages:
  - mcp_server_ref: {org: local, kind: mcp_server, slug: github}
  - mcp_server_ref: {org: local, kind: mcp_server, slug: github}

# ✓
mcp_server_usages:
  - mcp_server_ref: {org: local, kind: mcp_server, slug: github}
  - mcp_server_ref: {org: local, kind: mcp_server, slug: linear}
```

### Sub-agent exceeds parent tool scope

```yaml
# Parent enables: [search_code, get_file]
# ✗ Sub-agent tries to use delete_repo (not in parent's list)
mcp_access:
  - mcp_server: github
    enabled_tools: [search_code, delete_repo]

# ✓
mcp_access:
  - mcp_server: github
    enabled_tools: [search_code, get_file]
```

### Sub-agent references unknown MCP server

```yaml
# Parent has github; sub-agent references slack
# ✗
mcp_access:
  - mcp_server: slack

# ✓ — add slack to parent first, or remove from sub-agent
```

### Missing required fields in resource references

```yaml
# ✗
skill_refs:
  - org: local
  - slug: my-skill

# ✓
skill_refs:
  - org: local
    kind: skill
    slug: my-skill
```

### Inventing resource slugs without querying

```yaml
# ✗ — assumes github MCP server exists; never verified
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github

# ✓ — first call: get_mcp_server(org: "local", slug: "github")
#      confirm it exists and check its tool list, then write the YAML
```

### Setting status field

```yaml
# ✗ — status is system-managed
status:
  default_instance_id: "abc123"

# ✓ — omit status entirely
```

---

## 10. CLI Validation Commands

```bash
# Validate YAML syntax and schema without creating or updating
stigmer agent apply agent.yaml --dry-run

# List existing agents (to check for name/slug conflicts)
stigmer agent list

# Inspect an existing agent as YAML
stigmer agent get <slug> --output yaml

# Search for agents by keyword
stigmer agent search "code review"
```
