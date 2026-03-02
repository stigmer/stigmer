# Agent YAML Schema Reference

Complete field reference for `agentic.stigmer.ai/v1` Agent resources,
derived from the proto source of truth.

---

## Table of Contents

1. [Top-Level Structure](#1-top-level-structure)
2. [Metadata Fields](#2-metadata-fields)
3. [Spec Fields](#3-spec-fields)
4. [McpServerUsage](#4-mcpserverusage)
5. [ToolApprovalOverride](#5-toolapprovaloverride)
6. [Skill References](#6-skill-references)
7. [SubAgent](#7-subagent)
8. [McpAccess](#8-mcpaccess)
9. [ApiResourceReference Format](#9-apiresourcereference-format)
10. [EnvironmentSpec](#10-environmentspec)
11. [Status Fields (read-only)](#11-status-fields-read-only)

---

## 1. Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # required; exact string
kind: Agent                          # required; exact string, capital A
metadata: { ... }                    # required
spec: { ... }                        # required
# status: {}                         # NEVER set by users; system-managed
```

| Field | Required | Constraint |
|---|---|---|
| `apiVersion` | Yes | Exactly `agentic.stigmer.ai/v1` (proto const) |
| `kind` | Yes | Exactly `Agent` (proto const) |
| `metadata` | Yes | See §2 |
| `spec` | Yes | See §3 |
| `status` | Never | System-managed. Omit entirely from authored YAML. |

---

## 2. Metadata Fields

Source: `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Format | Notes |
|---|---|---|---|
| `name` | Yes | String | Human-readable name. |
| `slug` | No | `^[a-z][a-z0-9-]*$`, 1-63 chars | URL-friendly identifier, unique within org. Auto-generated from `name` if omitted. |
| `org` | Conditional | `^[a-z][a-z0-9-]*$`, 1-63 chars | **Local mode**: defaults to `local` if omitted. **Cloud mode**: required. |
| `visibility` | No | Enum string | `visibility_private` (default) or `visibility_public`. Public agents appear in marketplace. |
| `tags` | No | `[]string` | Categorization strings for search and filtering. |
| `labels` | No | `map<string,string>` | Key-value pairs for organization (e.g., `team: engineering`). |
| `annotations` | No | `map<string,string>` | Non-filtering metadata (e.g., `docs-url: "https://..."`). |
| `id` | Never | System | System-generated. Never set. |
| `version` | Never | System | System-managed version tracking. Never set. |

### Visibility values

| YAML Value | Behavior |
|---|---|
| *(omitted)* | Defaults to `visibility_private` |
| `visibility_private` | Only org members can access |
| `visibility_public` | Anyone can read; write still requires org membership |

---

## 3. Spec Fields

Source: `AgentSpec` in `ai/stigmer/agentic/agent/v1/spec.proto`.

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `description` | Strongly recommended | String | 1-2 sentences for UI/marketplace. No proto minimum, but omitting renders poorly in UI. |
| `icon_url` | No | String (URL) | Publicly accessible SVG, PNG, or JPEG. |
| `instructions` | Yes | `min_len = 10` (buf.validate) | System prompt. Use `|` block scalar for multi-line. |
| `mcp_server_usages` | No | See §4 | List of MCP servers this agent can use. |
| `skill_refs` | No | See §6 | List of skill references injected into agent context. |
| `sub_agents` | No | See §7 | Inline sub-agent definitions. |
| `env_spec` | No | See §10 | Environment variable schema for runtime binding. |

---

## 4. McpServerUsage

Source: `McpServerUsage` message in `spec.proto`.

```yaml
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
    enabled_tools:
      - search_code
      - create_pr
    tool_approval_overrides:
      - tool_name: create_pr
        requires_approval: true
        message: "Create PR: {{args.title}}"
```

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `mcp_server_ref` | Yes | `ApiResourceReference` | Must have `kind: mcp_server`. See §9. |
| `enabled_tools` | No | `[]string` | Exact tool names from server's `tools/list`. Empty = use server's `default_enabled_tools` (or all tools). |
| `tool_approval_overrides` | No | `[]ToolApprovalOverride` | Per-agent HITL gates. See §5. |

**Uniqueness**: `mcp_server_ref.slug` must be unique within the agent's
`mcp_server_usages`. One entry per server; combine all tools into it.

**CEL validation**: `mcp_server_ref.kind` must equal `mcp_server` (enum 44).
In YAML always write `kind: mcp_server` (string, not integer).

---

## 5. ToolApprovalOverride

Source: `ToolApprovalOverride` message in `spec.proto`.

Controls human-in-the-loop (HITL) approval for individual tools on a
per-agent basis. Sits in the middle of the approval policy chain:
`McpServer.default_tool_approvals` → `Agent.tool_approval_overrides`
→ `AgentExecution.auto_approve_all` (runtime bypass, highest priority).

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `tool_name` | Yes | `min_len = 1` | Case-sensitive. Must match MCP server's `tools/list` exactly. **Typo = silent failure** — no approval applied, no error. |
| `requires_approval` | Yes | `bool` | `true`: require approval even if McpServer default doesn't. `false`: disable approval even if McpServer default requires it. |
| `message` | No | String | Shown to user at approval prompt. Supports `{{args.field}}` placeholders. ≤100 chars recommended. |

### Message inheritance (when `requires_approval: true`)

1. If `message` is provided → use it (overrides McpServer default).
2. Else if McpServer has `default_tool_approvals` for this tool → use that message.
3. Else → auto-generates `"Execute tool: {tool_name}"`.

### Message template syntax

```
{{args.repo_name}}    →  replaced with actual tool argument value at runtime
{{tool_name}}         →  replaced with the tool name (always available)
```

Missing argument → replaced with `<unknown>`.

---

## 6. Skill References

Source: `repeated ApiResourceReference skill_refs` in `AgentSpec`.

Each entry must have `kind: skill` (CEL validates `kind == 43` internally;
YAML always uses string `skill`).

```yaml
skill_refs:
  - org: local
    kind: skill
    slug: code-review-best-practices
  - org: acme-corp
    kind: skill
    slug: security-checklist
    version: stable
```

See §9 for `ApiResourceReference` field rules.

**Version pinning** (skills only):

| `version` value | Resolution |
|---|---|
| *(omitted)* | Latest version |
| `latest` | Same as omitted |
| Tag name, e.g. `stable` | Mutable pointer; may change over time |
| 64-char hex hash | Immutable exact version |

**Injection at runtime**: skill `name` + `description` are always loaded.
Full `SKILL.md` body is loaded on-demand when the skill's description matches
the current request.

---

## 7. SubAgent

Source: `SubAgent` message in `spec.proto`. Sub-agents are defined **inline**
within the parent Agent — they are not separate platform resources.

```yaml
sub_agents:
  - name: code-reviewer
    description: "Reviews code for security and style"
    instructions: |
      You review code changes. Focus on security vulnerabilities,
      performance issues, and adherence to coding standards.
    mcp_access:
      - mcp_server: github
        enabled_tools:
          - search_code
          - get_file
    skill_refs:
      - org: local
        kind: skill
        slug: security-checklist
```

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `name` | Yes | String | Unique within `sub_agents`. Used for delegation routing and logging. |
| `description` | No | String | Used by parent to decide when to delegate. Write clearly. |
| `instructions` | Yes | `min_len = 10` | Sub-agent's system prompt. |
| `mcp_access` | No | `[]McpAccess` | MCP server access grants. See §8. If omitted, sub-agent has no tool access. |
| `skill_refs` | No | `[]ApiResourceReference` | Independent of parent — any skill is valid, not just parent's. |

---

## 8. McpAccess

Source: `McpAccess` message in `spec.proto`. Grants a sub-agent access to
one of the parent's MCP servers.

```yaml
mcp_access:
  - mcp_server: github          # slug from parent's mcp_server_usages
    enabled_tools:              # subset of parent's enabled_tools for this server
      - search_code
      - get_file
  - mcp_server: slack
    # enabled_tools omitted = all tools parent has for slack
```

| Field | Required | Constraint | Notes |
|---|---|---|---|
| `mcp_server` | Yes | String slug | Must match `mcp_server_ref.slug` from one of the parent's `mcp_server_usages`. |
| `enabled_tools` | No | `[]string` | Subset of parent's enabled tools. Empty = all tools parent has. Cannot expand beyond parent. |

**Permission model** (strictly enforced at runtime):
- Sub-agent can only access MCP servers listed in `mcp_access`.
- `enabled_tools` must be ⊆ parent's `enabled_tools` for that server.
- Sub-agents can **restrict** but **never expand** tool access.

---

## 9. ApiResourceReference Format

Source: `ApiResourceReference` in `ai/stigmer/commons/apiresource/io.proto`.

Used for both `mcp_server_ref` (inside `McpServerUsage`) and items in `skill_refs`.

| Field | Required | Format | Notes |
|---|---|---|---|
| `org` | Yes | `^[a-z][a-z0-9-]*$`, 1-63 chars | Organization owning the resource. `local` for local mode. |
| `kind` | Yes | Lowercase enum string | `skill` or `mcp_server`. Never use integers (43, 44). |
| `slug` | Yes | `^[a-z][a-z0-9-]*$`, 1-63 chars | Resource slug. Must start with a letter. |
| `version` | No | Tag, hash, or empty | Meaningful only for skills. |

### Kind values (YAML string, not integer)

| YAML | Proto enum int | Resource type |
|---|---|---|
| `skill` | 43 | Skill knowledge package |
| `mcp_server` | 44 | MCP server tool provider |

---

## 10. EnvironmentSpec

Source: `EnvironmentSpec` in `ai/stigmer/agentic/environment/v1/spec.proto`.

Declares required environment variables as a schema. Actual values are
provided at runtime via the AgentInstance's environment binding (not in the
Agent YAML).

```yaml
env_spec:
  data:
    API_URL:
      description: "Base URL of the target API"
      is_secret: false
    AUTH_TOKEN:
      description: "API authentication token"
      is_secret: true
```

| Field | Notes |
|---|---|
| `data` | Map of env var name → `EnvironmentValue` |
| `data.<VAR>.description` | Documentation shown in UI when configuring an AgentInstance. |
| `data.<VAR>.is_secret` | `true`: encrypted at rest, redacted in logs. `false`: plaintext, visible in audit logs. |
| `data.<VAR>.value` | Leave empty in Agent spec. Values are provided at runtime. |

---

## 11. Status Fields (read-only)

**Never set `status` in authored YAML.** These are populated by the platform.

| Field | Description |
|---|---|
| `status.default_instance_id` | ID of the auto-created default AgentInstance. |
| `status.audit` | Audit trail: `created_by`, `created_at`, `updated_by`, `updated_at`, last `event` type. |
