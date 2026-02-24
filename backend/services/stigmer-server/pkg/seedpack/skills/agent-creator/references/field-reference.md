# Agent Field Reference

Complete field specification for `agentic.stigmer.ai/v1` Agent resources.

## Table of Contents
1. [Top-Level Structure](#top-level-structure)
2. [metadata](#metadata)
3. [spec](#spec)
4. [spec.mcp_server_usages](#specmcp_server_usages)
5. [spec.skill_refs](#specskill_refs)
6. [spec.sub_agents](#specsub_agents)
7. [spec.env_spec](#specenv_spec)
8. [ApiResourceReference format](#apiresourcereference-format)

---

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # REQUIRED — exactly this string
kind: Agent                          # REQUIRED — exactly this string
metadata: …                          # REQUIRED
spec: …                              # REQUIRED
# status: DO NOT SET — system-managed
```

---

## metadata

| Field | Required | Type | Rules |
|-------|----------|------|-------|
| `name` | **Yes** | string | Human-readable name; no strict format enforced |
| `slug` | No | string | Auto-generated from name if omitted. Pattern: `[a-z][a-z0-9-]{0,62}` |
| `labels` | No | map\<string,string\> | Key-value pairs for filtering/organization |
| `tags` | No | string[] | Lowercase strings for search and categorization |

---

## spec

| Field | Required | Type | Constraint |
|-------|----------|------|------------|
| `description` | **Yes** | string | 1–2 sentences; shown in UI and marketplace |
| `icon_url` | No | string | Must be publicly accessible; SVG, PNG, or JPEG |
| `instructions` | **Yes** | string | **Minimum 10 characters.** This is the agent's system prompt. |
| `mcp_server_usages` | No | McpServerUsage[] | Each slug must be unique within the list |
| `skill_refs` | No | ApiResourceReference[] | `kind` must be `skill` (numeric: 43) |
| `sub_agents` | No | SubAgent[] | Names must be unique within the list |
| `env_spec` | No | EnvironmentSpec | Declares required env-var schema (values provided at runtime) |

---

## spec.mcp_server_usages

Each entry grants the agent access to one MCP server.

```yaml
mcp_server_usages:
  - mcp_server_ref:                 # REQUIRED
        org: local                  # REQUIRED
        kind: mcp_server            # REQUIRED — must be lowercase "mcp_server"
        slug: github                # REQUIRED — must match a real McpServer slug
      enabled_tools:                # OPTIONAL — empty = McpServer's default_enabled_tools
        - search_code
        - create_pr
      tool_approval_overrides:      # OPTIONAL
        - tool_name: delete_repo    # REQUIRED — case-sensitive, exact match
          requires_approval: true   # REQUIRED — true = approval needed; false = bypass
          message: "Delete {{args.repo_name}}"  # OPTIONAL; supports {{args.field}}
```

### enabled_tools
- Empty list → inherits `McpServer.spec.default_enabled_tools` (all tools if that is also empty).
- Non-empty list → only these tools are available to the agent (and its sub-agents at most).
- Tool names must **exactly** match what the MCP server reports (case-sensitive).

### tool_approval_overrides
- Overrides the McpServer's `default_tool_approvals` for this agent.
- `requires_approval: true` → forces approval even if McpServer has no default.
- `requires_approval: false` → bypasses approval even if McpServer requires it by default.
- `message` supports `{{args.field_name}}` and `{{tool_name}}` placeholders.
- If `message` is empty and `requires_approval: true`, auto-generates: `"Execute tool: <tool_name>"`.
- Keep messages under 100 characters for clean UI display.

### Approval policy precedence (lowest → highest)
1. `McpServer.spec.default_tool_approvals`
2. `Agent.spec.mcp_server_usages[].tool_approval_overrides`  ← this level
3. `AgentExecution.auto_approve_all` (runtime bypass)

---

## spec.skill_refs

```yaml
skill_refs:
  - org: local           # REQUIRED
    kind: skill          # REQUIRED — must be lowercase "skill"
    slug: my-skill       # REQUIRED — must match a real Skill slug
    version: stable      # OPTIONAL — tag name, SHA256 hash, or omit for latest
```

| Field | Required | Rules |
|-------|----------|-------|
| `org` | **Yes** | Organization owning the skill (e.g. `local`) |
| `kind` | **Yes** | Must be exactly `skill` (lowercase). Numeric equivalent: 43 |
| `slug` | **Yes** | Exact skill slug from the platform |
| `version` | No | Empty/omitted = latest. Tag name (e.g. `stable`) or 64-char SHA256 hash |

---

## spec.sub_agents

Sub-agents enable the parent to delegate specialized tasks.

```yaml
sub_agents:
  - name: code-reviewer             # REQUIRED — unique within sub_agents list
    description: "Reviews code…"    # OPTIONAL — helps parent decide when to delegate
    instructions: |                 # REQUIRED — minimum 10 characters
      You review code for…
    mcp_access:                     # OPTIONAL
      - mcp_server: github          # REQUIRED — must match a slug from parent's mcp_server_usages
        enabled_tools:              # OPTIONAL — must be SUBSET of parent's enabled_tools for this server
          - search_code
          - get_file
    skill_refs:                     # OPTIONAL — independent of parent; same format as spec.skill_refs
      - org: local
        kind: skill
        slug: code-review-guide
```

### Permission model
- `mcp_access[].mcp_server` → must equal the **slug** from one of the parent's
  `mcp_server_usages[].mcp_server_ref.slug`.
- `mcp_access[].enabled_tools` → must be a **subset** of the parent's `enabled_tools` for
  that server. Empty = all of the parent's tools for that server (no further restriction).
- Sub-agents **cannot** introduce new MCP servers not in the parent's `mcp_server_usages`.
- Sub-agent `skill_refs` are **fully independent** — any valid skill can be referenced.
- Sub-agent names must be **unique** within the `sub_agents` list.

---

## spec.env_spec

Declares the schema of required environment variables. Actual values are injected at runtime
via the AgentInstance's environment; values here can be empty.

```yaml
env_spec:
  data:
    API_URL:
      description: "Base URL for the external API"
      is_secret: false
      # value: ""   # leave empty in spec; provided at runtime
    AUTH_TOKEN:
      description: "API authentication token"
      is_secret: true
```

| Field | Type | Description |
|-------|------|-------------|
| `data` | map\<string, EnvironmentValue\> | Key = env var name (UPPER_SNAKE_CASE convention) |
| `EnvironmentValue.description` | string | Documents the variable for operators |
| `EnvironmentValue.is_secret` | bool | `true` = encrypted at rest and redacted in logs |
| `EnvironmentValue.value` | string | Leave empty in spec; provided at runtime |

---

## ApiResourceReference format

Used in both `mcp_server_usages[].mcp_server_ref` and `skill_refs[]`:

```yaml
org: local          # Organization slug — "local" for local/bootstrapped resources
kind: mcp_server    # "mcp_server" (kind=44) OR "skill" (kind=43) — always lowercase
slug: my-resource   # URL-friendly slug: [a-z][a-z0-9-]{0,62}
version: stable     # Skills only — tag or SHA256 hash; omit for latest
```

- `org` is **always required** — never omit it.
- `kind` must be lowercase (`skill`, `mcp_server`). Capitalized variants are invalid.
- `slug` pattern: lowercase alphanumeric plus hyphens, starts with a letter, 1–63 chars.
- `version` is only meaningful for `kind: skill`; omit for `kind: mcp_server`.
