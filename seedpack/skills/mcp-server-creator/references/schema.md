# McpServer YAML Schema Reference

Complete field reference for `agentic.stigmer.ai/v1` McpServer resources. Derived from proto definitions — treat this as authoritative.

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # REQUIRED — exactly this string
kind: McpServer                      # REQUIRED — exactly "McpServer" (PascalCase)
metadata:                            # REQUIRED
  name: github                       # REQUIRED — human-readable name
  org: local                         # local mode default; required in cloud mode
  slug: github                       # optional — auto-derived from name if omitted
  visibility: visibility_private     # optional — default is visibility_private
  labels:                            # optional — key-value pairs for filtering
    category: vcs
  annotations:                       # optional — key-value pairs, not for filtering
    docs-url: "https://..."
  tags:                              # optional — string array for categorization
    - git
    - vcs
spec:                                # REQUIRED
  description: "..."                 # strongly recommended
  icon_url: "https://..."            # optional — publicly accessible image URL
  tags: []                           # optional — spec-level tags (separate from metadata.tags)
  stdio: ...                         # CONDITIONALLY REQUIRED — exactly one of stdio or http
  http: ...                          # CONDITIONALLY REQUIRED — exactly one of stdio or http
  default_enabled_tools: []          # optional — empty = all tools enabled
  env_spec: ...                      # optional — declare required env vars
  default_tool_approvals: []         # optional — tools requiring user approval
status: {}                           # NEVER set by users — system-managed only
```

## metadata Fields

| Field | Required | Rules |
|---|---|---|
| `name` | Yes | Human-readable. Used to auto-generate `slug` if omitted. |
| `slug` | No | URL-friendly identifier. Format: `^[a-z][a-z0-9-]*$` (1–63 chars). This is what agents use in `mcp_server_ref.slug`. |
| `org` | Depends | Local mode: defaults to `local`. Cloud mode: required, must match authenticated org. |
| `visibility` | No | `visibility_private` (default) or `visibility_public` (marketplace). |
| `labels` | No | Key-value, used for filtering in list operations. |
| `annotations` | No | Key-value, not indexed. Use for docs URLs, support links, etc. |
| `tags` | No | String array for search/categorization. |
| `id` | Never | System-generated — do not set. |
| `version` | Never | System-managed — do not set. |

## spec.stdio (StdioServerConfig)

Use for subprocess-based servers. Most community MCP servers use this type.

| Field | Required | Description |
|---|---|---|
| `command` | Yes | Executable name (resolved via PATH) or absolute path. E.g., `npx`, `python`, `./my-server`. |
| `args` | No | Arguments array. Order matters. |
| `working_dir` | No | Working directory. Use absolute paths for reliability. |

```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    working_dir: /opt/mcp  # optional
```

## spec.http (HttpServerConfig)

Use for remote/hosted MCP services. The service must already be running.

| Field | Required | Rules |
|---|---|---|
| `url` | Yes | Valid HTTP or HTTPS URL (validated at apply time). |
| `headers` | No | Map of header name → value. Values support `${VAR_NAME}` env var interpolation. |
| `query_params` | No | Map of param name → value. Values support `${VAR_NAME}` env var interpolation. |
| `timeout_seconds` | No | Integer 0–300. Default 30 if not set. |

```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"
    headers:
      Authorization: "Bearer ${API_TOKEN}"
      X-API-Version: "2024-01"
    query_params:
      region: "${AWS_REGION}"
    timeout_seconds: 60
```

**Important:** `${VAR_NAME}` is for environment variable injection into HTTP config — resolved by the agent runner from the AgentInstance's environment. Do NOT confuse with `{{args.field}}` which is used in approval messages.

## spec.env_spec (EnvironmentSpec)

Declares the credential/configuration schema. Values are provided at runtime via AgentInstance — never pre-fill secrets here.

```yaml
spec:
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo and read:org scopes"
        is_secret: true
        # value: ""  ← leave empty for secrets; agent instance provides the actual value
      GITHUB_OWNER:
        description: "Default GitHub organization or username (e.g., acme-corp)"
        is_secret: false
        # value: "acme-corp"  ← non-secrets MAY have a default value
```

| Field | Description |
|---|---|
| `is_secret: true` | Value encrypted at rest, redacted in logs. Never pre-fill in YAML. |
| `is_secret: false` | Stored as plaintext, visible in audit logs. May have a default value. |
| `description` | Shown in UI when configuring AgentInstance. Be precise about required format and permissions. |
| `value` | Leave empty for secrets. May pre-fill non-secret defaults. |

## spec.default_enabled_tools

Platform-level tool gate. Empty = all tools enabled. Non-empty = only listed tools are available to any agent referencing this server.

```yaml
spec:
  default_enabled_tools:
    - search_code
    - get_file_contents
    - list_issues
    - create_pull_request
    # Tools not listed here are unavailable to all agents by default
```

**Rules:**
- Tool names must match exactly (case-sensitive) what the MCP server reports via `tools/list`.
- Agents can only use a subset of this list — they cannot add tools beyond it.
- Run `stigmer discover mcp-server <slug>` to get authoritative tool names.

## spec.default_tool_approvals (ToolApprovalPolicy[])

Defines which tools require human approval by default for all agents using this server.

```yaml
spec:
  default_tool_approvals:
    - tool_name: delete_repository
      message: "Delete repository: {{args.repo}}"
    - tool_name: merge_pull_request
      message: "Merge PR #{{args.pull_number}} in {{args.repo}}"
    - tool_name: drop_table
      message: "Drop table {{args.table_name}} in {{args.database}}"
```

| Field | Required | Rules |
|---|---|---|
| `tool_name` | Yes | Case-sensitive exact match with server's `tools/list`. Min 1 char. Typos are silently ignored. |
| `message` | No | Approval prompt. Supports `{{args.field_name}}` and `{{tool_name}}` placeholders. Auto-generated if empty: `"Execute tool: {tool_name}"`. Max ~100 chars for UI. |

### Message Placeholder Syntax

| Syntax | Context | Resolved By | Example |
|---|---|---|---|
| `{{args.field_name}}` | `default_tool_approvals.message`, `tool_approval_overrides.message` | Approval engine, from tool call arguments | `{{args.repo}}` → `"acme-corp/webapp"` |
| `{{tool_name}}` | Same as above | Always available | `{{tool_name}}` → `"delete_repository"` |
| `${VAR_NAME}` | HTTP `headers`, `query_params` | Agent runner, from environment | `${API_TOKEN}` → `"Bearer eyJ..."` |

## Three-Layer Approval Policy Chain

```
McpServer.default_tool_approvals   → base, applies to ALL agents
        ↓ (overridden by)
Agent.mcp_server_usages[*].tool_approval_overrides  → per-agent customization
        ↓ (bypassed by)
AgentExecution.auto_approve_all    → runtime bypass (trusted pipelines)
```

An agent can:
- Add approval for a tool the McpServer doesn't require (`requires_approval: true`)
- Remove approval for a tool the McpServer requires (`requires_approval: false`)
- Customize the approval message

## Status Fields (Read-Only)

Never set these. Read them after applying to verify state.

| Field | Description |
|---|---|
| `status.validation_state` | `valid`, `invalid`, or `validation_state_unspecified` |
| `status.validation_message` | Error details when `invalid` |
| `status.discovered_capabilities` | Snapshot of tools from `tools/list` — populated by `stigmer discover mcp-server <slug>` |

## slug vs kind in Different Contexts

| Context | `kind` value | Notes |
|---|---|---|
| McpServer resource YAML (`kind:`) | `McpServer` (PascalCase) | The top-level resource declaration |
| Agent's `mcp_server_ref.kind` | `mcp_server` (snake_case) | The `ApiResourceReference` enum value |
| Agent's `mcp_access.mcp_server` | (slug string, no `kind`) | Sub-agent references use slug directly |

## CLI Commands

```bash
# Create or update (idempotent)
stigmer mcp-server apply mcpserver.yaml

# Dry-run validation without applying
stigmer mcp-server apply mcpserver.yaml --dry-run

# Get with full status (including discovered tools)
stigmer mcp-server get <slug> --output yaml

# List all in org
stigmer mcp-server list

# Discover tools and populate status.discovered_capabilities
stigmer discover mcp-server <slug>

# Delete
stigmer mcp-server delete <slug>
```
