# Agent YAML Field Reference

Complete field documentation for `agentic.stigmer.ai/v1` Agent resources.
Source of truth: `apis/ai/stigmer/agentic/agent/v1/spec.proto` and
`apis/ai/stigmer/commons/apiresource/metadata.proto`.

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # required, exact string
kind: Agent                          # required, exact string
metadata: {}                         # required
spec: {}                             # required
# status: never set by users
```

---

## metadata

| Field | Required | Format | Notes |
|---|---|---|---|
| `name` | Yes | Free string | Human-readable name. Displayed in UI and `stigmer list agents`. |
| `slug` | No | `^[a-z][a-z0-9-]*$`, ≤ 63 chars | Auto-generated from `name` if omitted. Used in CLI references and API. |
| `org` | Recommended | `^[a-z][a-z0-9-]*$`, ≤ 63 chars | Owning organization (e.g., `acme-corp`, `default`). CLI resolves from context if omitted. |
| `visibility` | No | enum string | `visibility_private` (default) or `visibility_public` (marketplace). |
| `labels` | No | `map<string, string>` | Filterable key-value pairs (e.g., `team: engineering`). |
| `annotations` | No | `map<string, string>` | Non-filterable metadata (e.g., `docs-url: "https://..."`). |
| `tags` | No | `[]string` | Search and categorization (e.g., `[code-review, security]`). |
| `id` | No | System-generated | Never set by users. |
| `version` | No | System-managed | Never set by users. |

### visibility values

| Value | Meaning |
|---|---|
| `visibility_private` | Only org members can see and run the agent. Default when omitted. |
| `visibility_public` | Discoverable in the Stigmer marketplace; anyone can reference it. Write access still requires org membership. |

---

## spec

| Field | Required | Notes |
|---|---|---|
| `description` | Strongly recommended | 1-2 sentence summary for UI and marketplace. No proto enforcement but required for good UX. |
| `icon_url` | No | Publicly accessible URL (SVG, PNG, JPEG) for the agent's icon. |
| `instructions` | Yes | System prompt. **Minimum 10 characters** (proto-enforced). Use `\|` block scalar for multi-line. |
| `mcp_server_usages` | No | List of MCP server declarations. See [McpServerUsage](#mcpserverusage). |
| `skill_refs` | No | List of skill references. See [skill_refs](#skill_refs). |
| `sub_agents` | No | List of sub-agent definitions. See [SubAgent](#subagent). |
| `env_spec` | No | Environment variable schema. See [env_spec](#env_spec). |

---

## mcp_server_usages

Declares MCP servers the agent can use. Each entry is a `McpServerUsage`.

```yaml
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server            # required, lowercase string
      slug: github                # required; must exist on platform
      # org: acme-corp            # omit for same-org; set for cross-org public servers
    enabled_tools:                # optional; empty = McpServer's default_enabled_tools
      - search_code
      - create_pr
    tool_approval_overrides:      # optional HITL customization
      - tool_name: create_pr
        requires_approval: true
        message: "Create PR: {{args.title}} in {{args.repo}}"
```

### McpServerUsage fields

| Field | Required | Notes |
|---|---|---|
| `mcp_server_ref` | Yes | `ApiResourceReference` with `kind: mcp_server` and `slug`. |
| `enabled_tools` | No | Tool names (case-sensitive, exact match). Empty = all McpServer defaults. |
| `tool_approval_overrides` | No | Per-agent approval overrides. See [ToolApprovalOverride](#toolapprovaloverride). |

**Constraint:** Each `mcp_server_ref.slug` must be **unique** within
`mcp_server_usages`. You cannot reference the same server twice.

### ToolApprovalOverride fields

| Field | Required | Notes |
|---|---|---|
| `tool_name` | Yes | Exact tool name (min 1 char). Case-sensitive. Typos are **silently ignored**—no error. |
| `requires_approval` | Yes | `true` = require approval (even if McpServer default says no). `false` = skip approval (overrides McpServer default). |
| `message` | No | Shown to user at approval. Supports `{{args.field_name}}` placeholders. Keep under 100 chars. |

**Approval policy chain (lowest → highest priority):**
1. `McpServer.default_tool_approvals`
2. `Agent.mcp_server_usages[*].tool_approval_overrides` ← this field
3. `AgentExecution.auto_approve_all` (runtime bypass)

### message placeholder syntax

`{{args.field_name}}` — replaced with the actual tool argument at runtime.
Valid field names come from the tool's `input_schema.properties` keys
(visible in `stigmer get mcp-server <slug> --output yaml`).

Example: `"Deploy {{args.app_name}} to {{args.environment}}"`

---

## skill_refs

References to Skill resources that inject knowledge into the agent's context.

```yaml
skill_refs:
  - kind: skill                   # required, lowercase string
    slug: code-review-checklist   # required; must exist on platform
    # org: acme-corp              # omit for same-org
    # version: stable             # optional; see version pinning
```

### ApiResourceReference fields (for skill_refs)

| Field | Required | Format | Notes |
|---|---|---|---|
| `kind` | Yes | `skill` | Always lowercase. Never `43`. |
| `slug` | Yes | `^[a-z][a-z0-9-]*$`, ≤ 63 chars | Skill slug. Must exist on platform. |
| `org` | No | `^[a-z][a-z0-9-]*$` | Omit for same-org. Set for cross-org public skills. |
| `version` | No | tag, hash, or empty | See version pinning below. |

### Version pinning

| Value | Behavior |
|---|---|
| omitted / empty | Latest version (most recently published) |
| `latest` | Same as empty |
| tag (e.g., `stable`, `v1.0`) | Mutable pointer—may change over time |
| 64-char hex hash | Immutable—always the same content |

Use tags for convenience, hashes for reproducibility in production.

---

## sub_agents

Inline sub-agent definitions. Sub-agents are not separate resources—they live
inside the parent Agent YAML.

```yaml
sub_agents:
  - name: code-reviewer           # required, unique within parent
    description: "Reviews code for security and quality"
    instructions: |               # required, min 10 chars
      You review code for security vulnerabilities and coding standards.
    mcp_access:
      - mcp_server: github        # slug from parent's mcp_server_usages
        enabled_tools:            # subset of parent's enabled_tools for this server
          - search_code
          - get_file
    skill_refs:                   # independent of parent's skills
      - kind: skill
        slug: security-checklist
```

### SubAgent fields

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Unique within `sub_agents`. Used for delegation routing. |
| `description` | No | Helps parent decide when to delegate. Be specific. |
| `instructions` | Yes | Min 10 characters. Sub-agent's system prompt. |
| `mcp_access` | No | Access grants to parent's MCP servers. See [McpAccess](#mcpaccess). |
| `skill_refs` | No | Independent of parent. Any skill can be referenced. |

### McpAccess fields

| Field | Required | Notes |
|---|---|---|
| `mcp_server` | Yes | Slug matching one of the parent's `mcp_server_usages[*].mcp_server_ref.slug`. |
| `enabled_tools` | No | **Must be a subset** of parent's `enabled_tools` for this server. Empty = all parent tools. |

### Permission model summary

```
Parent declares: mcp_server_usages: [github (tools A, B, C, D)]
Sub-agent may use: mcp_access: github with tools ⊆ {A, B, C, D}
Sub-agent CANNOT: reference a server not in parent's mcp_server_usages
Sub-agent CANNOT: add a tool the parent does not have
Sub-agent CAN: reference any skill (independent of parent's skill_refs)
```

---

## env_spec

Declares the schema of environment variables required by the agent (or its MCP
servers) at runtime. Values are provided at execution time via the
AgentInstance's environment binding.

```yaml
env_spec:
  data:
    GITHUB_TOKEN:
      description: "GitHub personal access token with repo and read:org scopes"
      is_secret: true
    API_BASE_URL:
      description: "Base URL of the target API (e.g., https://api.example.com)"
      is_secret: false
```

### EnvironmentValue fields

| Field | Notes |
|---|---|
| `value` | Leave empty in Agent spec. Actual values go in AgentInstance. |
| `is_secret` | `true`: encrypted at rest, redacted in logs. `false`: plaintext, visible in audit logs. |
| `description` | Shown in UI when configuring AgentInstance. Be specific about required format/permissions. |

**Security note (2026-03):** Auto-resolved well-known credentials
(`GITHUB_TOKEN`, `PLANTON_API_KEY`, etc.) are only injected into an execution
if declared here. Always declare any env var the agent or its MCP servers need.

---

## ApiResourceReference format (canonical)

Used in both `mcp_server_usages[*].mcp_server_ref` and `skill_refs`.

| Field | Required | Format | Notes |
|---|---|---|---|
| `kind` | Yes | `skill` or `mcp_server` | Lowercase string. Never use integers. |
| `slug` | Yes | `^[a-z][a-z0-9-]*$`, 1-63 chars | Must exist on the platform. |
| `org` | No | `^[a-z][a-z0-9-]*$`, 0-63 chars | Omit for same-org relative references. |
| `version` | No (Skills only) | tag, hash, or empty | Ignored for MCP servers. |

---

## Common pitfalls

| Pitfall | Correct form |
|---|---|
| `kind: 43` or `kind: 44` | `kind: skill` or `kind: mcp_server` |
| `kind: Skill` or `kind: MCP_SERVER` | `kind: skill` or `kind: mcp_server` |
| Slug with uppercase or underscores | Lowercase + hyphens only: `my-agent` |
| Instructions `"Helper"` (too short) | At least 10 chars of meaningful text |
| Duplicate MCP server slug in one agent | Merge into single entry with all tools |
| Sub-agent tool not in parent's list | Only subset of parent tools allowed |
| Sub-agent references server not in parent | Must match parent's `mcp_server_usages` slug |
| Tool approval override with typo in `tool_name` | Silently ignored—verify exact names via `get_mcp_server` |
| `status:` field set by user | Never set `status`—system-managed only |
| Missing `metadata.name` | Always required |
