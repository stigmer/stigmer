# Validation Rules and Common Pitfalls

All rules are derived from proto `buf.validate` constraints and CEL expressions
in `ai/stigmer/agentic/agent/v1/spec.proto`.

---

## Table of Contents

1. [Proto-enforced constraints](#1-proto-enforced-constraints)
2. [Business logic rules](#2-business-logic-rules)
3. [Common pitfalls](#3-common-pitfalls)
4. [Pre-apply checklist](#4-pre-apply-checklist)

---

## 1. Proto-enforced Constraints

These are checked by `buf.validate` on every apply. Violations cause an error.

| Rule | Field | Constraint |
|---|---|---|
| `apiVersion` const | `api_version` | Must equal exactly `agentic.stigmer.ai/v1` |
| `kind` const | `kind` | Must equal exactly `Agent` |
| `metadata` required | `metadata` | Must be present |
| Instructions minimum length | `spec.instructions` | `min_len = 10` |
| Sub-agent name required | `sub_agents[*].name` | `required = true` |
| Sub-agent instructions min length | `sub_agents[*].instructions` | `min_len = 10` |
| McpAccess server required | `mcp_access[*].mcp_server` | `required = true` |
| ToolApprovalOverride tool_name | `tool_approval_overrides[*].tool_name` | `min_len = 1` |
| MCP server ref required | `mcp_server_usages[*].mcp_server_ref` | `required = true` |
| MCP ref kind (CEL) | `mcp_server_usages[*].mcp_server_ref.kind` | Must be `mcp_server` (enum 44) |
| Skill ref kind (CEL) | `skill_refs[*].kind` | Must be `skill` (enum 43) |
| Sub-agent skill ref kind (CEL) | `sub_agents[*].skill_refs[*].kind` | Must be `skill` (enum 43) |

---

## 2. Business Logic Rules

These are enforced at runtime, not at apply time. Violations cause failures
during agent execution.

| Rule | Detail |
|---|---|
| MCP server slug uniqueness | Each `mcp_server_ref.slug` must appear at most once in `mcp_server_usages`. |
| MCP server must exist | Referenced slugs must exist on the platform at execution time. |
| Skill must exist | Referenced skill slugs must exist on the platform at execution time. |
| Sub-agent MCP server scope | `mcp_access[*].mcp_server` must match a slug from the parent's `mcp_server_usages`. |
| Sub-agent tool subset | `mcp_access[*].enabled_tools` must be a subset of the parent's `enabled_tools` for that server. |
| Tool names must match | `enabled_tools` and `tool_approval_overrides[*].tool_name` must match the MCP server's actual `tools/list` (case-sensitive). Invalid tool names silently have no effect. |

---

## 3. Common Pitfalls

### Pitfall A — Integer `kind` values

The proto uses integer enum values internally. In YAML, always use the
lowercase string name.

```yaml
# WRONG
kind: 43
kind: 44

# CORRECT
kind: skill
kind: mcp_server
```

### Pitfall B — Capitalisation in `kind` and enum fields

```yaml
# WRONG
kind: Skill
kind: MCP_SERVER
kind: McpServer
visibility: Public
visibility: VISIBILITY_PUBLIC

# CORRECT
kind: skill
kind: mcp_server
visibility: visibility_public
```

### Pitfall C — Instructions too short

The 10-character minimum is enforced at the proto level. Single words fail.

```yaml
# WRONG (7 characters)
instructions: "Helper"

# CORRECT
instructions: "You are a helpful assistant that answers questions clearly."
```

### Pitfall D — Duplicate MCP server slugs

Each server may appear only once in `mcp_server_usages`. Combine all tools
from the same server into a single entry.

```yaml
# WRONG — github appears twice
mcp_server_usages:
  - mcp_server_ref: { kind: mcp_server, slug: github }
    enabled_tools: [search_code]
  - mcp_server_ref: { kind: mcp_server, slug: github }
    enabled_tools: [create_pr]

# CORRECT — single entry with all tools
mcp_server_usages:
  - mcp_server_ref: { kind: mcp_server, slug: github }
    enabled_tools: [search_code, create_pr]
```

### Pitfall E — Sub-agent tool exceeds parent's grant

Sub-agents can only use tools the parent has enabled.

```yaml
# Parent has: enabled_tools: [search_code, get_file]

# WRONG — delete_repo not in parent's enabled_tools
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, delete_repo]  # delete_repo not granted

# CORRECT
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code]  # subset of parent
```

### Pitfall F — Sub-agent references MCP server not in parent

```yaml
# Parent mcp_server_usages only has: github

# WRONG
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: slack  # parent does not have slack

# CORRECT — only reference what parent has
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: github
```

### Pitfall G — Typo in `tool_approval_overrides.tool_name`

A typo silently disables the approval. No error is raised. This is the
platform's forward-compatibility design — unknown tool names are ignored.

```yaml
# WRONG — typo: "delet" instead of "delete"
tool_approval_overrides:
  - tool_name: delet_repository   # typo; approval silently not applied
    requires_approval: true

# CORRECT
tool_approval_overrides:
  - tool_name: delete_repository
    requires_approval: true
```

**Always verify tool names** with `get_mcp_server` before writing overrides.

### Pitfall H — Referencing slugs that do not exist

Runtime failures, not apply-time failures. The apply command succeeds, but
execution fails when the runner cannot resolve the reference.

```yaml
# WRONG — guessing a slug
skill_refs:
  - kind: skill
    slug: my-great-skill   # hallucinated; does not exist

# CORRECT — confirmed via search/get before writing
skill_refs:
  - kind: skill
    slug: code-review-best-practices  # confirmed to exist
```

### Pitfall I — Missing required fields in references

`kind` and `slug` are required in every `ApiResourceReference`.
`org` is optional — when omitted, it resolves from the parent resource's org.

```yaml
# WRONG — missing kind
skill_refs:
  - slug: my-skill

# CORRECT
skill_refs:
  - kind: skill
    slug: my-skill
```

### Pitfall J — Slug format violations

Slugs must match `^[a-z][a-z0-9-]*$` and be 1-63 characters.

```yaml
# WRONG
slug: Code_Reviewer       # uppercase and underscore
slug: codeReviewer        # camelCase
slug: 2nd-reviewer        # starts with digit
slug: my--double-dash     # consecutive hyphens

# CORRECT
slug: code-reviewer
slug: reviewer-v2
slug: my-agent
```

### Pitfall K — Setting `status` in YAML

Status is system-managed. Never include it in authored YAML.

```yaml
# WRONG
status:
  default_instance_id: "..."

# CORRECT — omit status entirely
```

### Pitfall L — Using `kind: agent` in `mcp_server_ref`

```yaml
# WRONG
mcp_server_ref:
  kind: agent    # wrong kind
  slug: github

# CORRECT
mcp_server_ref:
  kind: mcp_server
  slug: github
```

### Pitfall M — Non-block-scalar instructions with newlines

Use `|` block scalar for multi-line instructions.

```yaml
# WRONG — inline string with literal \n
instructions: "You are an agent.\nDo things."

# CORRECT
instructions: |
  You are an agent.
  Do things.
```

---

## 4. Pre-Apply Checklist

### Required structure
- [ ] `apiVersion: agentic.stigmer.ai/v1`
- [ ] `kind: Agent`
- [ ] `metadata.name` present
- [ ] `spec.instructions` ≥ 10 characters

### Organization and visibility
- [ ] `metadata.org` matches the `STIGMER_ORG_ID` environment variable
- [ ] `metadata.visibility` is omitted (private) or `visibility_public` (intentional)

### Resource discovery (before writing any reference)
- [ ] Every `mcp_server_ref.slug` confirmed via `get_mcp_server` or `search`
- [ ] Every `skill_refs[*].slug` confirmed via `get_skill` or `search`
- [ ] `enabled_tools` values verified from the server's actual tool list

### Reference format
- [ ] All `kind` values are lowercase strings (`skill`, `mcp_server`)
- [ ] All `slug` values match `^[a-z][a-z0-9-]*$`, 1-63 chars
- [ ] `org` omitted for same-org references (resolved from parent resource's org)
- [ ] If `org` is explicit, it matches `^[a-z][a-z0-9-]*$`

### MCP server usages
- [ ] Each `mcp_server_ref.slug` appears at most once
- [ ] `tool_approval_overrides[*].tool_name` verified (case-sensitive, no typos)

### Sub-agents
- [ ] Each sub-agent `name` is unique
- [ ] Each sub-agent `instructions` ≥ 10 characters
- [ ] Each `mcp_access[*].mcp_server` matches a parent `mcp_server_usages` slug
- [ ] Each `mcp_access[*].enabled_tools` ⊆ parent's enabled tools for that server

### YAML hygiene
- [ ] Multi-line instructions use `|` block scalar
- [ ] No `status` field
- [ ] No integer `kind` values
- [ ] 2-space indentation throughout
