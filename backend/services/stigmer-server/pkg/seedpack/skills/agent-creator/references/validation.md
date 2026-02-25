# Validation Checklist and Common Pitfalls

## Table of Contents
1. [Pre-Apply Checklist](#pre-apply-checklist)
2. [Common Pitfalls](#common-pitfalls)

---

## Pre-Apply Checklist

Work through every applicable section before finalizing the YAML.

### Required Fields

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `Agent`
- [ ] `metadata.name` is present
- [ ] `spec.instructions` is present and **at least 10 characters** (enforced by proto validation)
- [ ] `spec.description` is present and clearly describes the agent's purpose

### Organization and Visibility

- [ ] `metadata.org` is set — `local` for local mode; real org slug for cloud mode
- [ ] `metadata.visibility` is intentional — omit for private (default); `visibility_public` only for marketplace

### Resource References (skill_refs and mcp_server_usages)

- [ ] `kind` in all references uses lowercase strings (`skill`, `mcp_server`) — **never integers** (`43`, `44`)
- [ ] All `org` values are lowercase alphanumeric + hyphens, start with a letter, 1–63 chars
- [ ] All `slug` values are lowercase alphanumeric + hyphens, start with a letter, 1–63 chars
- [ ] **Every referenced MCP server was verified to exist** using `get_mcp_server` before writing
- [ ] **Every referenced skill was verified to exist** using `get_skill` before writing

### MCP Server Usages

- [ ] Each MCP server `slug` appears **exactly once** in `mcp_server_usages` (no duplicates)
- [ ] All tool names in `enabled_tools` exactly match tools reported by the MCP server
- [ ] All tool names in `tool_approval_overrides` exactly match MCP server tool names (case-sensitive)

### Sub-Agents

- [ ] All sub-agent `name` values are unique within `sub_agents`
- [ ] Every sub-agent `instructions` is at least 10 characters
- [ ] Every `mcp_access[*].mcp_server` value matches a `slug` from the parent's `mcp_server_usages`
- [ ] Every sub-agent `enabled_tools` is a **subset** of the parent's `enabled_tools` for that MCP server

### YAML Syntax

- [ ] Multi-line `instructions` use `|` block scalar style
- [ ] All YAML is syntactically valid (no unclosed strings, missing colons, etc.)
- [ ] No tabs used for indentation (YAML requires spaces)

---

## Common Pitfalls

### ❌ Using integers for `kind` in references

The proto enum uses integers internally (`skill = 43`, `mcp_server = 44`). YAML always uses the lowercase string name.

```yaml
# Wrong
- org: local
  kind: 43
  slug: my-skill

# Correct
- org: local
  kind: skill
  slug: my-skill
```

---

### ❌ Using wrong capitalization in `kind`

```yaml
# Wrong
kind: Skill
kind: MCP_SERVER
kind: McpServer

# Correct
kind: skill
kind: mcp_server
```

---

### ❌ Instructions too short

The `instructions` field has a **10-character minimum** enforced at validation time. Truncated or placeholder instructions will be rejected.

```yaml
# Wrong — only 6 characters
instructions: "Helper"

# Correct
instructions: "You are a helpful assistant that answers questions clearly."
```

---

### ❌ Guessing resource slugs without verifying

Never write a `slug` without first confirming the resource exists on the platform. Agents with unresolvable references fail at runtime.

```yaml
# Wrong — assumed github exists without checking
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github   # did you verify this?
```

**Fix:** Call `get_mcp_server(org="local", slug="github")` before writing this reference. If it doesn't exist, ask the user rather than inventing a reference.

---

### ❌ Duplicate MCP server slugs in one agent

Each MCP server may appear **at most once** in `mcp_server_usages`. Combine tools into a single entry.

```yaml
# Wrong — github appears twice
mcp_server_usages:
  - mcp_server_ref: { org: local, kind: mcp_server, slug: github }
    enabled_tools: [search_code]
  - mcp_server_ref: { org: local, kind: mcp_server, slug: github }
    enabled_tools: [create_pr]

# Correct — single entry, all tools combined
mcp_server_usages:
  - mcp_server_ref: { org: local, kind: mcp_server, slug: github }
    enabled_tools: [search_code, create_pr]
```

---

### ❌ Sub-agent tools exceeding parent's tools

Sub-agent tools must be a **strict subset** of what the parent has enabled. A sub-agent cannot grant itself tools the parent doesn't have.

```yaml
# Wrong — parent has [search_code, get_file] but sub-agent adds delete_repo
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, delete_repo]   # delete_repo NOT in parent

# Correct — only tools the parent already enables
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]
```

---

### ❌ Sub-agent referencing an MCP server the parent doesn't declare

The `mcp_server` field in `mcp_access` must match a slug from the parent's `mcp_server_usages`. There is no way to grant a sub-agent access to a server the parent hasn't declared.

```yaml
# Wrong — parent has no slack in mcp_server_usages
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: slack   # parent never declared this

# Correct — only reference servers the parent declares
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: github   # parent has this in mcp_server_usages
```

---

### ❌ Typos in tool_approval_overrides tool names (silent failure)

A typo in `tool_name` causes the override to be **silently ignored** — no error, no warning. The approval policy simply doesn't apply. This is a security-relevant failure mode.

```yaml
# Dangerous — typo means delete_repository has NO approval requirement
tool_approval_overrides:
  - tool_name: delet_repository   # missing 'e' — silently ignored
    requires_approval: true

# Correct — exact match
tool_approval_overrides:
  - tool_name: delete_repository
    requires_approval: true
```

**Always verify tool names** by calling `get_mcp_server` and checking the server's tool list before writing overrides.

---

### ❌ Wrong slug format

Slugs must match `^[a-z][a-z0-9-]*$` — lowercase, hyphens only, starts with a letter.

```yaml
# Wrong
slug: Code_Reviewer    # uppercase + underscores
slug: codeReviewer     # camelCase
slug: 2nd-reviewer     # starts with digit

# Correct
slug: code-reviewer
slug: second-reviewer
```

---

### ❌ Setting status in YAML

`status` is system-managed and must never appear in user-authored YAML. The server will reject or ignore it.

```yaml
# Wrong
status:
  default_instance_id: "abc123"

# Correct — omit status entirely
```

---

### ❌ Missing required fields in ApiResourceReference

Every reference needs all three of `org`, `kind`, and `slug`.

```yaml
# Wrong — missing kind and slug
skill_refs:
  - org: local

# Correct
skill_refs:
  - org: local
    kind: skill
    slug: my-skill
```

---

### ❌ Omitting metadata.org in cloud mode

In cloud mode, `metadata.org` is required. In local mode it defaults to `local`.

```yaml
# Wrong for cloud mode
metadata:
  name: my-agent
  # org missing

# Correct for cloud mode
metadata:
  name: my-agent
  org: acme-corp
```
