# Agent YAML Schema Reference

## Table of Contents
1. [Top-Level Structure](#top-level-structure)
2. [metadata Fields](#metadata-fields)
3. [spec Fields](#spec-fields)
4. [ApiResourceReference Format](#apiresourcereference-format)
5. [McpServerUsage](#mcpserverusage)
6. [ToolApprovalOverride](#toolapprovaloverride)
7. [SubAgent](#subagent)
8. [McpAccess](#mcpaccess)
9. [env_spec](#env_spec)

---

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # Required. Exact string.
kind: Agent                          # Required. Exact string.
metadata: ...                        # Required. See below.
spec: ...                            # Required. See below.
# status: NEVER set by users — system-managed only
```

---

## metadata Fields

| Field | Required | Rules | Notes |
|---|---|---|---|
| `name` | Yes | Any human-readable string | Displayed in UI and marketplace |
| `slug` | No | `^[a-z][a-z0-9-]*$`, 1–63 chars | Auto-generated from `name` if omitted |
| `org` | Situational | `^[a-z][a-z0-9-]*$`, 1–63 chars | Local mode: defaults to `local`. Cloud mode: required. |
| `visibility` | No | `visibility_private` or `visibility_public` | Default: `visibility_private`. Use `visibility_public` only for marketplace publishing. |
| `labels` | No | `map<string, string>` | For filtering (e.g., `team: engineering`) |
| `annotations` | No | `map<string, string>` | Non-filtering metadata (e.g., `docs-url: "https://..."`) |
| `tags` | No | `[]string` | For search and categorization |
| `id` | Never | System-generated | Do not set in YAML |
| `version` | Never | System-managed | Do not set in YAML |

---

## spec Fields

| Field | Required | Rules | Notes |
|---|---|---|---|
| `description` | Recommended | String | 1–2 sentence summary. Omitting causes poor UI/marketplace rendering. |
| `icon_url` | No | Publicly accessible URL | SVG, PNG, or JPEG |
| `instructions` | Yes | String, **min 10 characters** (enforced) | Agent's system prompt. Use `\|` block scalar for multi-line. |
| `mcp_server_usages` | No | `[]McpServerUsage` | Each MCP server slug must be unique within this list. |
| `skill_refs` | No | `[]ApiResourceReference` | Must use `kind: skill`. |
| `sub_agents` | No | `[]SubAgent` | Defined inline. Not separate resources. |
| `env_spec` | No | `EnvironmentSpec` | Declares required env vars. Values are provided at runtime. |

---

## ApiResourceReference Format

Used in `skill_refs` (and inside `mcp_server_ref`):

```yaml
org: local          # Required. Org that owns the resource.
kind: skill         # Required. Use "skill" or "mcp_server" — never integers.
slug: my-skill      # Required. Lowercase alphanumeric + hyphens, starts with letter, 1–63 chars.
version: stable     # Optional. Skills only. Tag name, 64-char hex hash, or omit for latest.
```

**Kind values — always use lowercase string names in YAML:**

| YAML string | Enum int | Meaning |
|---|---|---|
| `skill` | 43 | Skill resource |
| `mcp_server` | 44 | MCP Server resource |

**Version pinning (skills only):**

| Value | Resolves to |
|---|---|
| omitted / `latest` | Most recently published version |
| tag name (e.g., `stable`) | Mutable pointer; may change over time |
| 64-char hex hash | Exact immutable version |

---

## McpServerUsage

Declares an MCP server the agent can use.

```yaml
mcp_server_usages:
  - mcp_server_ref:           # Required. ApiResourceReference with kind: mcp_server.
      org: local
      kind: mcp_server
      slug: github
    enabled_tools:            # Optional. Empty = McpServer's default_enabled_tools (or all).
      - search_code
      - create_pr
    tool_approval_overrides:  # Optional. Per-agent HITL policy customization.
      - tool_name: delete_repository
        requires_approval: true
        message: "Delete repo: {{args.repo_name}}"
```

**Constraint:** The `slug` from each `mcp_server_ref` must be **unique** within `mcp_server_usages`. You cannot reference the same MCP server twice.

---

## ToolApprovalOverride

Customizes Human-in-the-Loop (HITL) approval for specific tools.

| Field | Required | Rules |
|---|---|---|
| `tool_name` | Yes | Exact, case-sensitive match to MCP server tool name. Min 1 char. |
| `requires_approval` | Yes | `true`: requires approval even if McpServer default says no. `false`: no approval even if McpServer default says yes. |
| `message` | No | Shown to user before approval. Supports `{{args.field}}` placeholders. Keep under 100 chars. |

**Policy chain (highest priority wins):**
1. `McpServer.default_tool_approvals` (lowest)
2. `Agent.McpServerUsage.tool_approval_overrides` ← this field
3. `AgentExecution.auto_approve_all` (highest — runtime bypass)

**Silent failure risk:** A typo in `tool_name` silently disables the policy for that tool — no error, no warning. Always verify tool names from the platform before writing overrides.

---

## SubAgent

Defined inline within the parent agent. Not a separate resource.

```yaml
sub_agents:
  - name: code-reviewer          # Required. Unique within parent's sub_agents.
    description: "Reviews code for security and quality"
    instructions: |              # Required. Min 10 characters.
      You review code changes. Focus on security vulnerabilities and coding standards.
    mcp_access:                  # Optional. Grants access to parent's MCP servers.
      - mcp_server: github       # Must match a slug in parent's mcp_server_usages.
        enabled_tools:           # Must be a SUBSET of parent's enabled_tools for this server.
          - search_code
          - get_file
    skill_refs:                  # Optional. Independent of parent's skills.
      - org: local
        kind: skill
        slug: security-checklist
```

**Permission model (strict containment):**
- Sub-agents can only access MCP servers the parent declares in `mcp_server_usages`
- Sub-agent `enabled_tools` must be a **subset** of parent's enabled tools — can restrict, never expand
- Sub-agent `skill_refs` are **independent** — can reference any skill the parent doesn't have

---

## McpAccess

Used inside `sub_agents[*].mcp_access`:

| Field | Required | Rules |
|---|---|---|
| `mcp_server` | Yes | Slug of parent's MCP server. Must match `mcp_server_ref.slug` in parent's `mcp_server_usages`. |
| `enabled_tools` | No | Subset of parent's enabled tools for this server. Empty = all of parent's tools for this server. |

---

## env_spec

Declares required environment variables. Values are **not** stored here — they are bound at runtime via AgentInstance.

```yaml
env_spec:
  data:
    API_URL:
      description: "Base URL for the target API"
      is_secret: false
    AUTH_TOKEN:
      description: "API authentication token"
      is_secret: true
      # value: optionally pre-populate non-secret defaults here
```

| Field | Description |
|---|---|
| `description` | Shown in UI when configuring an AgentInstance |
| `is_secret` | `true`: encrypted at rest, redacted in logs. `false`: plaintext, visible in audit logs. |
| `value` | Optional default. Typically omitted; provided at runtime. Never use for secrets. |
