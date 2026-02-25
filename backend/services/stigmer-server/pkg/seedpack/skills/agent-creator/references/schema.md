# Agent Schema Reference

Complete field documentation for the `agentic.stigmer.ai/v1` Agent resource,
derived from the canonical protobuf definitions.

## Table of Contents

1. [Top-Level Fields](#1-top-level-fields)
2. [metadata](#2-metadata)
3. [spec](#3-spec)
4. [spec.mcp_server_usages](#4-specmcp_server_usages)
5. [spec.skill_refs](#5-specskill_refs)
6. [spec.sub_agents](#6-specsubagents)
7. [spec.env_spec](#7-specenv_spec)
8. [ApiResourceReference](#8-apiresourcereference)
9. [status (system-managed)](#9-status-system-managed)

---

## 1. Top-Level Fields

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `apiVersion` | Yes | Must be `agentic.stigmer.ai/v1` (exact string, const-validated) | Proto const validation — any other value is rejected |
| `kind` | Yes | Must be `Agent` (exact string, const-validated) | Proto const validation |
| `metadata` | Yes | See §2 | |
| `spec` | Yes (implicitly) | See §3 | Omitting spec yields an agent with no instructions |
| `status` | No | System-managed — never set by users | Set by the backend on create/update |

---

## 2. `metadata`

| Field | Required | Format | Notes |
|---|---|---|---|
| `name` | Yes | Free-form human-readable string | Used in the UI and CLI |
| `slug` | No | `^[a-z][a-z0-9-]{0,61}[a-z0-9]$` or single char `[a-z]` | Auto-generated from `name` if omitted. Set only when a specific URL identifier is needed. |
| `labels` | No | `map<string, string>` | Arbitrary key-value pairs for filtering and organisation (e.g., `team: engineering`) |
| `tags` | No | `string[]` | Free-form strings for categorisation and search (e.g., `["code-review", "security"]`) |
| `org` | No | Organisation identifier | Usually inferred from your auth context; use when creating cross-org resources |

**Slug rules:**
- Lowercase alphanumeric characters and hyphens only
- Must start with a letter
- 1–63 characters total
- Examples: `my-agent`, `code-reviewer`, `a` ✓
- Invalid: `My_Agent`, `123agent`, `-agent`, `agent-` ✗

---

## 3. `spec`

| Field | Required | Type | Constraint | Notes |
|---|---|---|---|---|
| `description` | Yes (strong convention) | `string` | None (proto); should be 1–2 sentences | Shown in the UI and marketplace. Describe what the agent does and its primary capabilities. |
| `icon_url` | No | `string` | Valid URL to SVG, PNG, or JPEG | Publicly accessible. Shown in marketplace and agent configuration screens. |
| `instructions` | Yes | `string` | `min_len: 10` (proto-validated) | The agent's system prompt. Must be substantive — a 10-character minimum is enforced but aim for meaningful behavioral guidance. |
| `mcp_server_usages` | No | `McpServerUsage[]` | Each entry must reference `kind: mcp_server` (kind=44) | See §4 |
| `skill_refs` | No | `ApiResourceReference[]` | Each entry must have `kind: skill` (kind=43) | See §5 |
| `sub_agents` | No | `SubAgent[]` | Sub-agent names unique within the list | See §6 |
| `env_spec` | No | `EnvironmentSpec` | — | See §7 |

---

## 4. `spec.mcp_server_usages`

Each element is a `McpServerUsage`.

| Field | Required | Type | Notes |
|---|---|---|---|
| `mcp_server_ref` | Yes | `ApiResourceReference` | Must have `kind: mcp_server`. The `slug` from this ref becomes the identifier sub-agents use in `mcp_access`. |
| `enabled_tools` | No | `string[]` | Tool names must match **exactly** (case-sensitive) what the MCP server reports via `tools/list`. Empty = use `McpServer.default_enabled_tools` (or all tools if that is also empty). |
| `tool_approval_overrides` | No | `ToolApprovalOverride[]` | Per-agent customisation of the approval policy. Overrides `McpServer.default_tool_approvals`. |

**MCP server slug uniqueness:** Each `mcp_server_ref.slug` must appear exactly once in `mcp_server_usages`. Duplicates are invalid.

### `ToolApprovalOverride`

| Field | Required | Type | Notes |
|---|---|---|---|
| `tool_name` | Yes | `string` (min_len: 1) | Case-sensitive. Must match the actual MCP tool name. Invalid names are silently ignored (forward-compatibility). |
| `requires_approval` | Yes | `bool` | `true` = always require approval (even if MCP server has no default). `false` = never require approval (overrides MCP server default). |
| `message` | No | `string` | Shown to user at approval time. Supports `{{args.field}}` placeholders. Keep under 100 chars. If empty and `requires_approval: true`, falls back to the McpServer's default message for that tool, or auto-generates `"Execute tool: {tool_name}"`. |

**Approval policy chain (lowest → highest priority):**
1. `McpServer.default_tool_approvals` (platform/org defaults)
2. `Agent.mcp_server_usages[].tool_approval_overrides` (per-agent)
3. `AgentExecution.auto_approve_all` (runtime bypass)

---

## 5. `spec.skill_refs`

Each element is an `ApiResourceReference` with `kind: skill`.

| Field | Required | Value |
|---|---|---|
| `org` | Yes | Organisation that owns the skill (e.g., `local`, `acme-corp`) |
| `kind` | Yes | Must be `skill` (string literal; maps to kind=43 internally) |
| `slug` | Yes | Skill slug, lowercase hyphenated, 1–63 chars |
| `version` | No | Tag name (e.g., `stable`, `v1.0`) or content hash. Omit to resolve to latest. |

**How skills are injected at runtime:**
1. The backend resolves each `skill_ref` to its `SKILL.md` content.
2. The skill's `name` and `description` (from YAML frontmatter) are always in context.
3. The full `SKILL.md` body loads when the skill triggers.
4. Bundled resources (`references/`, `scripts/`, `assets/`) load on demand.

Skills are **not executed** — they are read and injected as context.

---

## 6. `spec.sub_agents`

Each element is a `SubAgent`.

| Field | Required | Type | Constraint | Notes |
|---|---|---|---|---|
| `name` | Yes | `string` | `required: true`; unique within `sub_agents` | Routing identifier. Used for delegation logging. Examples: `code-reviewer`, `researcher`. |
| `description` | No | `string` | — | Helps the parent decide when to delegate. |
| `instructions` | Yes | `string` | `min_len: 10` | Sub-agent's own system prompt. Minimum 10 characters enforced. |
| `mcp_access` | No | `McpAccess[]` | — | Grants access to a subset of the parent's MCP servers. See below. |
| `skill_refs` | No | `ApiResourceReference[]` | `kind: skill` required | Independent from parent's skill_refs — can reference any skill. |

### `McpAccess` (within `sub_agents[].mcp_access`)

| Field | Required | Type | Notes |
|---|---|---|---|
| `mcp_server` | Yes | `string` | Must match the `slug` of one of the **parent's** `mcp_server_usages[].mcp_server_ref.slug` entries. |
| `enabled_tools` | No | `string[]` | Must be a **subset** of the parent's `enabled_tools` for the named server. Empty = all of the parent's enabled tools for this server (no additional restriction). |

**Permission model summary:**
- Sub-agents can only access MCP servers the parent declared.
- Sub-agents can only use tools the parent already enabled (subset enforcement).
- Sub-agents' `skill_refs` are fully independent — they may reference any skill.

---

## 7. `spec.env_spec`

Declares required environment variables. Values are provided at runtime via `AgentInstance`'s environment — not stored in the agent spec.

```yaml
env_spec:
  data:
    VARIABLE_NAME:
      description: "Human-readable explanation of what this variable is"
      is_secret: true   # true = encrypted at rest, redacted in logs
      # value: ""       # optional; leave empty in spec (populated at runtime)
```

| Field | Type | Notes |
|---|---|---|
| `data` | `map<string, EnvironmentValue>` | Key = environment variable name (uppercase by convention) |
| `EnvironmentValue.description` | `string` | Documents the variable for operators |
| `EnvironmentValue.is_secret` | `bool` | `true` = encrypted at rest and redacted in logs |
| `EnvironmentValue.value` | `string` | Leave empty in spec; values are injected at runtime |

---

## 8. `ApiResourceReference`

Used in `mcp_server_ref`, `skill_refs`, and sub-agent `skill_refs`.

| Field | Required | Notes |
|---|---|---|
| `org` | Yes | Organisation owning the resource. `local` for platform/single-tenant resources. Organisation name (e.g., `acme-corp`) for org-scoped resources. |
| `kind` | Yes | `mcp_server` for MCP servers. `skill` for skills. Lowercase string — the platform maps these to integer kind IDs internally (mcp_server=44, skill=43). |
| `slug` | Yes | URL-friendly identifier. Lowercase alphanumeric + hyphens, starts with a letter, 1–63 chars. Must match an actually existing resource (verify via Stigmer MCP tools). |
| `version` | No (skills only) | Empty = latest. Tag name (e.g., `stable`) or content hash for pinning. Not applicable to MCP server refs. |

---

## 9. `status` (system-managed)

Never set `status` in user-authored YAML. It is populated by the backend.

| Field | Notes |
|---|---|
| `status.audit` | Created/updated timestamps and creator identity |
| `status.default_instance_id` | ID of the automatically created default `AgentInstance`. Every agent has exactly one default instance (no environment, uses agent defaults). |
