# McpServer YAML Schema Reference

Complete field reference for the `agentic.stigmer.ai/v1` McpServer resource.
Source of truth: protos in `ai/stigmer/agentic/mcpserver/v1/`.

## Table of Contents
1. [Top-Level Structure](#top-level-structure)
2. [Metadata Fields](#metadata-fields)
3. [Spec Fields](#spec-fields)
4. [Server Types: stdio vs http](#server-types)
5. [Environment Spec](#environment-spec)
6. [Default Enabled Tools](#default-enabled-tools)
7. [Default Tool Approvals](#default-tool-approvals)
8. [Status Fields (system-managed)](#status-fields)

---

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # REQUIRED — exact string, validated by proto
kind: McpServer                      # REQUIRED — exact string, PascalCase
metadata: ...                        # REQUIRED
spec: ...                            # REQUIRED
# status: omit entirely or leave as {}  — system-managed, never set by users
```

| Field | Required | Constraint |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `McpServer` (PascalCase) |
| `metadata` | Yes | See [Metadata Fields](#metadata-fields) |
| `spec` | Yes | See [Spec Fields](#spec-fields) |
| `status` | Never set | System-managed; omit or leave `{}` |

---

## Metadata Fields

Defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name (e.g., `"GitHub MCP Server"` or `"github"`). Used to auto-generate slug if omitted. |
| `metadata.slug` | No | URL-friendly identifier. Auto-generated from name if omitted. Format: `^[a-z][a-z0-9-]*$`, 1–63 chars. **This is what agents use in `mcp_server_ref.slug`.** |
| `metadata.id` | No | System-generated. Never set by users. |
| `metadata.org` | Recommended | Organization owning this resource. Required in cloud mode. Resolved from CLI context if omitted. |
| `metadata.visibility` | No | `visibility_private` (default): org-only access. `visibility_public`: marketplace (any org can reference). |
| `metadata.labels` | No | Key-value pairs for filtering (e.g., `category: vcs`). |
| `metadata.annotations` | No | Key-value pairs for additional metadata not used for filtering (e.g., `docs-url: "https://..."`). |
| `metadata.tags` | No | String array for search/categorization. |

### Visibility

```yaml
# Private (default) — only org members can access
metadata:
  visibility: visibility_private

# Public — any org can discover and reference this server (marketplace)
metadata:
  visibility: visibility_public
```

### Slug Rules

- Lowercase alphanumeric and hyphens only: `github`, `my-db-v2`
- Starts with a letter (not digit or hyphen)
- 1–63 characters
- **No underscores**: `github_mcp` is invalid; use `github-mcp`
- This slug is used in: `mcp_server_ref.slug` in Agent YAML and `mcp_access.mcp_server` in sub-agents

---

## Spec Fields

| Field | Required | Description |
|---|---|---|
| `spec.description` | Recommended | What the server does and primary use cases. Shown in marketplace and agent config UI. |
| `spec.icon_url` | No | Public image URL (SVG/PNG/JPEG) for marketplace display. |
| `spec.tags` | No | Categorization tags for marketplace. Separate from `metadata.tags`. Use lowercase hyphenated values. |
| `spec.stdio` | Conditionally | stdio transport config. Exactly one of `stdio` or `http` required. |
| `spec.http` | Conditionally | HTTP transport config. Exactly one of `stdio` or `http` required. |
| `spec.default_enabled_tools` | No | Default tool whitelist. Empty = all tools enabled. See [Default Enabled Tools](#default-enabled-tools). |
| `spec.env_spec` | No | Environment variable schema (not values). See [Environment Spec](#environment-spec). |
| `spec.default_tool_approvals` | No | Tools requiring approval by default. See [Default Tool Approvals](#default-tool-approvals). |

---

## Server Types

**Exactly one** of `stdio` or `http` must be specified in `spec`. This is a proto `oneof` with `required` validation — omitting both or specifying both fails validation.

### stdio — Subprocess Transport

Use for: Node.js (`npx`), Python modules, Go binaries, any CLI-based MCP server. **Most common type.**

```yaml
spec:
  stdio:
    command: npx                               # REQUIRED — executable name or path
    args: ["-y", "@modelcontextprotocol/server-github"]  # optional
    working_dir: /opt/my-server                # optional — use absolute paths
```

| Field | Required | Description |
|---|---|---|
| `command` | Yes | Executable to run: `npx`, `python`, `node`, `./binary`, absolute path. |
| `args` | No | Arguments list. Order matters. |
| `working_dir` | No | Working directory. Use absolute paths. Inherits agent runner's directory if omitted. |

**Credential injection:** Environment variables from AgentInstance's environment binding are passed to the subprocess automatically. Declare them in `env_spec`.

**Common patterns:**
```yaml
# Node.js via npx
stdio:
  command: npx
  args: ["-y", "@modelcontextprotocol/server-github"]

# Python module
stdio:
  command: python
  args: ["-m", "mcp_server_sqlite", "--db-path", "/data/db.sqlite"]

# Pinned version
stdio:
  command: npx
  args: ["-y", "@modelcontextprotocol/server-github@1.2.3"]

# Custom binary
stdio:
  command: ./mcp-server
  working_dir: /opt/my-mcp-server
  args: ["--config", "config.yaml"]
```

### http — Remote Service Transport

Use for: Hosted/managed MCP services, servers shared across many concurrent agents, servers behind an API gateway.

```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"          # REQUIRED — valid http/https URL
    headers:
      Authorization: "Bearer ${API_TOKEN}"     # ${VAR_NAME} for env var substitution
      X-API-Version: "2024-01"
    query_params:
      region: "${AWS_REGION}"
    timeout_seconds: 45                        # 0–300, default 30
```

| Field | Required | Description |
|---|---|---|
| `url` | Yes | Valid HTTP/HTTPS URL. Validated by `buf.validate.field.string.uri`. |
| `headers` | No | HTTP headers. Values support `${VAR_NAME}` env var substitution. |
| `query_params` | No | Query parameters. Values support `${VAR_NAME}` substitution. |
| `timeout_seconds` | No | 0–300 seconds. Default 30. Set higher for long-running operations. |

**⚠ Syntax distinction — do not confuse:**

| Syntax | Used In | Resolved By |
|---|---|---|
| `${VAR_NAME}` | HTTP `headers` and `query_params` values | Agent runner at request time, from AgentInstance environment |
| `{{args.field}}` | Approval message templates | Approval engine at tool call time, from tool arguments |

---

## Environment Spec

`env_spec` declares **what** credentials the server needs — not the actual values. Values are provided at runtime via the AgentInstance's environment binding.

```yaml
spec:
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo and read:org scopes"
        is_secret: true
        # value: ""  ← always leave empty in McpServer spec
      GITHUB_OWNER:
        description: "Default GitHub org or username (e.g., acme-corp)"
        is_secret: false
```

`EnvironmentValue` fields (from `ai/stigmer/agentic/environment/v1/spec.proto`):

| Field | Description |
|---|---|
| `is_secret` | `true`: encrypted at rest, redacted in logs. `false`: plaintext, visible in audit logs. |
| `description` | Shown in UI during AgentInstance setup. Be specific about format and required permissions. |
| `value` | **Leave empty in McpServer spec.** Actual values are provided via AgentInstance environment. |

**Rules:**
- Never pre-fill `value` for secrets in the spec (never commit credentials to version control)
- Non-secret shared defaults (e.g., `LOG_LEVEL: info`) may include a `value`
- For HTTP servers: every `${VAR_NAME}` in headers/params must have a corresponding `env_spec` entry

---

## Default Enabled Tools

`default_enabled_tools` is the **platform-level tool ceiling** — the maximum set agents can use. Agents can restrict further but cannot expand beyond it.

```yaml
spec:
  default_enabled_tools:
    - search_code
    - get_file_contents
    - list_issues
    - create_pull_request
    # delete_repository intentionally omitted — too destructive for defaults
```

**Rules:**
- Empty list = all tools enabled (agents restrict as needed)
- Non-empty list = whitelist; unlisted tools are unavailable to all agents
- Tool names must be **exact, case-sensitive** matches against `tools/list` from the server
- Unverified names are silently ignored (no error, tool just won't appear)

**Override chain:**

| Layer | Field | Who Sets |
|---|---|---|
| McpServer (ceiling) | `spec.default_enabled_tools` | McpServer author |
| Agent (restriction) | `mcp_server_usages[].enabled_tools` | Agent author |

---

## Default Tool Approvals

`default_tool_approvals` defines which tools require human approval before execution. Applied to **all** agents using this server. Agents can override per-tool.

```yaml
spec:
  default_tool_approvals:
    - tool_name: delete_repository
      message: "Delete repository: {{args.repo}}"
    - tool_name: force_push
      message: "Force push to {{args.branch}} on {{args.repo}}"
    - tool_name: merge_pull_request
      message: "Merge PR #{{args.pull_number}} in {{args.repo}}"
```

`ToolApprovalPolicy` fields:

| Field | Required | Description |
|---|---|---|
| `tool_name` | Yes | Exact tool name (case-sensitive). Silent failure if name doesn't match. Min 1 char. |
| `message` | No | Approval prompt shown to user. Supports `{{args.field}}` and `{{tool_name}}`. Auto-generated as `"Execute tool: {tool_name}"` if empty. |

**Message template guidelines:**
- Use `{{args.field_name}}` — filled from actual tool call arguments at runtime
- Missing args replaced with `<unknown>`
- Be specific and action-oriented: "Delete repository: {{args.repo}}" not "Perform delete"
- Keep under 100 characters

**Three-layer approval chain:**
```
McpServer.default_tool_approvals  (base — all agents)
        ↓ overridden by
Agent.tool_approval_overrides     (per-agent — can add/remove)
        ↓ overridden by
AgentExecution.auto_approve_all   (runtime bypass — trusted pipelines)
```

---

## Status Fields

**Never set by users.** Populated by the platform after `stigmer apply`.

| Field | Description |
|---|---|
| `status.validation_state` | `valid`, `invalid`, or `validation_state_unspecified` |
| `status.validation_message` | Why definition is invalid (populated only for `invalid`). |
| `status.discovered_capabilities` | Tools/resources from `stigmer discover mcp-server <slug>`. |
| `status.audit` | Standard audit trail (created_by, created_at, updated_by, updated_at). |

Run after apply to check:
```bash
stigmer get mcp-server <slug> --output yaml
# Check status.validation_state and status.discovered_capabilities
```
