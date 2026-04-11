# McpServer YAML Schema Reference

Complete field reference for the `agentic.stigmer.ai/v1` McpServer resource.
Proto source: `ai/stigmer/agentic/mcpserver/v1/spec.proto`.

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1    # required, exact string
kind: McpServer                       # required, exact string (PascalCase)
metadata:                             # required
  name: <string>                      # required — human-readable name
  slug: <string>                      # optional — auto-generated from name
  org: <string>                       # recommended — owning organization
  visibility: <enum>                  # optional — visibility_private (default) or visibility_public
  labels: {key: value}                # optional — filtering metadata
  annotations: {key: value}           # optional — non-filtering metadata
  tags: [string]                      # optional — categorization
spec:                                 # required
  description: <string>              # recommended — what the server does
  icon_url: <string>                 # optional — image URL for UI
  tags: [string]                     # optional — marketplace categorization
  stdio: <StdioServerConfig>         # exactly one of stdio or http (required)
  http: <HttpServerConfig>           # exactly one of stdio or http (required)
  default_enabled_tools: [string]    # optional — tool gate
  env: <EnvVarDeclaration map>       # optional — credential contract
  default_tool_approvals: [ToolApprovalPolicy]  # optional — approval policies
# status: {} — system-managed, never set by users
```

## Metadata Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Human-readable name (e.g., "GitHub MCP Server") |
| `slug` | No | URL-friendly ID, unique per org. Format: `^[a-z][a-z0-9-]*$`, 1–63 chars. Auto-generated from name if omitted. This is how agents reference the server. |
| `org` | Recommended | Owning organization. Auto-resolved from context if omitted. |
| `visibility` | No | `visibility_private` (default) or `visibility_public` (marketplace). |
| `labels` | No | Key-value pairs for filtering (e.g., `category: vcs`). |
| `annotations` | No | Key-value pairs not used for filtering (e.g., `docs-url: "https://..."`. |
| `tags` | No | String array for categorization and search. |

## StdioServerConfig

Subprocess-based server communicating over stdin/stdout.

| Field | Required | Description |
|---|---|---|
| `command` | Yes | Executable to run: binary name on PATH or absolute path. Examples: `npx`, `python`, `node`, `./mcp-server` |
| `args` | No | Arguments passed to the command. Order matters. |
| `working_dir` | No | Working directory for the process. Use absolute paths. |

Credential injection: environment variables from AgentInstance are passed directly to the subprocess.

## HttpServerConfig

Remote server communicating over HTTP POST + Server-Sent Events.

| Field | Required | Description |
|---|---|---|
| `url` | Yes | Base URL of the MCP endpoint. Must be valid HTTP/HTTPS URL. |
| `headers` | No | HTTP headers for every request. Values support `${VAR_NAME}` env var substitution. |
| `query_params` | No | Query parameters appended to URL. Values support `${VAR_NAME}` substitution. |
| `timeout_seconds` | No | Request timeout (0–300). Default: 30. Set higher for long-running operations. |

**Environment variable interpolation** in headers/params uses `${VAR_NAME}` syntax — resolved at runtime from AgentInstance's environment binding.

## Environment Variable Declarations (`env`)

Declares environment variables the server needs — schema only, not values. Each entry is an `EnvVarDeclaration`.

```yaml
env:
  VAR_NAME:
    is_secret: true/false      # true = encrypted at rest, redacted in logs
    description: "What this variable is for and required format/permissions"
    optional: true/false       # true = server works without it; default: false (required)
```

| EnvVarDeclaration Field | Description |
|---|---|
| `is_secret` | `true`: encrypted, redacted. `false`: plaintext, visible in audit logs. |
| `description` | Document required permissions, format, scopes. Shown in UI during setup. |
| `optional` | `false` (default): execution fails if missing. `true`: server degrades gracefully without it. |

## ToolApprovalPolicy (`default_tool_approvals`)

Defines which tools require human approval by default for all agents using this server.

| Field | Required | Description |
|---|---|---|
| `tool_name` | Yes | Exact tool name from `tools/list` (case-sensitive, min 1 char). |
| `message` | No | Approval prompt. Supports `{{args.field}}` and `{{tool_name}}` placeholders. If empty: auto-generates "Execute tool: {tool_name}". |

### Message Template Syntax

| Placeholder | Source | Behavior |
|---|---|---|
| `{{args.field_name}}` | Tool call arguments | Replaced with value; missing args become `<unknown>` |
| `{{tool_name}}` | Tool name | Always available |

Guidelines: be specific, use action verbs, include highest-risk arguments, keep under 100 characters.

## Default Enabled Tools (`default_enabled_tools`)

Platform-level tool gate — the default set of tools available when agents reference this server.

- Empty list → all tools enabled by default
- Non-empty list → only listed tools are available; agents can restrict further but never expand
- Tool names must match exactly what the server reports via `tools/list`

## Placeholder Syntax Summary

| Syntax | Context | Resolved By | Example |
|---|---|---|---|
| `${VAR_NAME}` | HTTP headers, query_params | Agent runner from environment | `"Bearer ${API_TOKEN}"` |
| `{{args.field}}` | Approval messages | Approval engine from tool args | `"Delete: {{args.repo}}"` |

**Never mix these two syntaxes** — `${VAR_NAME}` is for environment variable injection, `{{args.field}}` is for approval message rendering.
