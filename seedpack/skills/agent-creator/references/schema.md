# Agent YAML Full Schema Reference

Source of truth: `apis/ai/stigmer/agentic/agent/v1/` protos.

## Table of Contents
1. [Top-Level Structure](#1-top-level-structure)
2. [metadata Fields](#2-metadata-fields)
3. [spec Fields](#3-spec-fields)
4. [McpServerUsage](#4-mcpserverusage)
5. [ToolApprovalOverride](#5-toolapprovaloverride)
6. [SkillRef](#6-skillref)
7. [SubAgent](#7-subagent)
8. [McpAccess](#8-mcpaccess)
9. [env_spec](#9-env_spec)
10. [ApiResourceReference Format](#10-apiresourcereference-format)
11. [Visibility Enum](#11-visibility-enum)

---

## 1. Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # required; must be this exact string
kind: Agent                          # required; must be this exact string
metadata: {}                         # required; see §2
spec: {}                             # required; see §3
# status: {}                         # NEVER set by users — system-managed
```

---

## 2. metadata Fields

Defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Constraints | Notes |
|---|---|---|---|
| `name` | Yes | string | Human-readable name |
| `slug` | No | `^[a-z][a-z0-9-]*$`, 1-63 chars | Auto-derived from `name` if omitted |
| `id` | No | system-managed | Never set by users |
| `org` | Recommended | `^[a-z][a-z0-9-]*$` | Owning org; resolved from CLI context if omitted |
| `visibility` | No | enum string | `visibility_private` (default) or `visibility_public` |
| `labels` | No | map<string, string> | Filtering metadata, e.g. `team: engineering` |
| `annotations` | No | map<string, string> | Non-filtering metadata, e.g. `docs-url: "https://..."` |
| `tags` | No | string[] | Search/categorization, e.g. `["code-review", "security"]` |
| `version` | No | system-managed | Never set directly; tracks spec history |

### Organization resolution (priority chain)
1. `--org` CLI flag
2. `metadata.org` in YAML
3. `context.organization` from `~/.stigmer/config`
4. Error

### Visibility

```yaml
# Private — only org members can access (default)
visibility: visibility_private

# Public — marketplace; anyone can read, only org members can write
visibility: visibility_public
```

---

## 3. spec Fields

Defined by `AgentSpec` in `spec.proto`.

| Field | Required | Proto constraint | Notes |
|---|---|---|---|
| `description` | Strongly recommended | none (no proto validation) | 1-2 sentences; shown in UI and marketplace |
| `icon_url` | No | none | Publicly accessible image (SVG/PNG/JPEG) |
| `instructions` | Yes | `min_len = 10` | System prompt; use block scalar (`\|`) |
| `mcp_server_usages` | No | items must have `kind = mcp_server` | See §4 |
| `skill_refs` | No | items must have `kind = skill` | See §6 |
| `sub_agents` | No | none | See §7 |
| `env_spec` | No | none | See §9 |

---

## 4. McpServerUsage

```yaml
mcp_server_usages:
  - mcp_server_ref:           # required; ApiResourceReference (§10)
      kind: mcp_server        # must be the string "mcp_server"
      slug: github            # must be an existing MCP server slug
      org: acme-corp          # omit for same-org relative reference
    enabled_tools:            # optional; empty = McpServer's default_enabled_tools
      - search_code
      - create_pr
    tool_approval_overrides:  # optional; see §5
      - tool_name: create_pr
        requires_approval: true
        message: "Create PR: {{args.title}}"
```

**Uniqueness**: Each `mcp_server_ref.slug` must appear exactly once across all
`mcp_server_usages` in a single agent. Duplicate slugs are a validation error.

**`enabled_tools`**: Copy names verbatim from `status.discovered_capabilities.tools[*].name`
on the McpServer resource. Names are case-sensitive; typos silently have no effect.

---

## 5. ToolApprovalOverride

Defined by `ToolApprovalOverride` in `spec.proto`. Sits inside `McpServerUsage`.

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `tool_name` | Yes | `min_len = 1` | Exact, case-sensitive tool name |
| `requires_approval` | Yes | bool | `true` = add approval; `false` = remove MCP-level default |
| `message` | No | string | Shown to user on approval prompt; supports `{{args.field}}` |

Approval policy chain (highest priority wins):
1. `McpServer.default_tool_approvals` (lowest)
2. `Agent.McpServerUsage.tool_approval_overrides` (this field)
3. `AgentExecution.auto_approve_all = true` (highest — runtime bypass)

**Silent failure**: A `tool_name` that doesn't match any tool in the MCP server's
`tools/list` is silently ignored. Always verify exact tool names before writing overrides.

Message template placeholders: `{{args.<field>}}` where `<field>` comes from the
tool's `input_schema.properties`. Example: `{{args.repo}}`, `{{args.title}}`.

---

## 6. SkillRef

Each entry in `spec.skill_refs` is an `ApiResourceReference`:

```yaml
skill_refs:
  - kind: skill             # must be the string "skill"
    slug: code-review       # existing skill slug
    org: acme-corp          # omit for same-org reference
    version: stable         # omit for latest; tag or 64-char hash
```

Versions:
- Omit / `latest` → most recently published
- Tag (e.g., `stable`) → mutable pointer to a version
- 64-char hex hash → immutable, exact version

Sub-agent `skill_refs` are independent of the parent's; each can reference any skill.

---

## 7. SubAgent

Defined by `SubAgent` in `spec.proto`. Nested inside `spec.sub_agents[]`.

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `name` | Yes | required | Unique within parent; kebab-case recommended |
| `description` | No | none | Guides parent's delegation routing |
| `instructions` | Yes | `min_len = 10` | Sub-agent's system prompt |
| `mcp_access` | No | none | See §8 |
| `skill_refs` | No | `kind = skill` | Independent of parent's skills |

---

## 8. McpAccess

Grants a sub-agent access to one of the parent's MCP servers. Defined by `McpAccess`.

```yaml
mcp_access:
  - mcp_server: github        # slug ONLY — must match parent's mcp_server_ref.slug
    enabled_tools:            # subset of parent's enabled_tools for this server
      - search_code           # parent must have this tool enabled
      - get_file              # parent must have this tool enabled
  - mcp_server: slack
    # enabled_tools empty = all tools the parent has for this server
```

**Permission invariant**: Sub-agent tools ⊆ parent tools for every server. This is
checked at runtime; violations cause the execution to fail.

If a sub-agent has no `mcp_access` entries, it has **no** MCP server access at all.

---

## 9. env_spec

Declares required environment variables (schema only — values provided at runtime
via the AgentInstance's environment binding).

```yaml
env_spec:
  data:
    API_URL:
      description: "Base URL for the target API"
      is_secret: false
      value: ""               # leave empty; AgentInstance provides actual values
    AUTH_TOKEN:
      description: "API authentication token"
      is_secret: true
```

| Field | Description |
|---|---|
| `description` | Shown in UI when configuring AgentInstance |
| `is_secret` | `true` = encrypted at rest, redacted in logs |
| `value` | Leave empty in Agent spec; fill via AgentInstance environment binding |

---

## 10. ApiResourceReference Format

Used for both `mcp_server_ref` and `skill_refs` entries.

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `org` | No | `^$\|^[a-z][a-z0-9-]*$`, 0-63 chars | Omit for same-org (relative reference) |
| `kind` | Yes | lowercase string | `skill` or `mcp_server` — never integers |
| `slug` | Yes | `^[a-z][a-z0-9-]*$`, 1-63 chars | Must match a real resource slug |
| `version` | No | tag, hash, or empty | Skills only; ignored for MCP servers |

Canonical reference format in logs/UI: `org/slug` (e.g., `stigmer/github`).

### Kind String Values

| YAML String | Resource Type | Internal Enum |
|---|---|---|
| `skill` | Skill resource | 43 |
| `mcp_server` | MCP Server resource | 44 |

**Always use the lowercase string in YAML.** Never use the integer (`43`, `44`) or
alternate capitalizations (`Skill`, `MCP_SERVER`, `McpServer`).

---

## 11. Visibility Enum

| YAML Value | Meaning |
|---|---|
| `visibility_private` | Only org members can access (default) |
| `visibility_public` | Anyone can read; write requires org membership |

Use `visibility_public` only for marketplace publishing. Omit for private agents.
