# McpServer Schema Reference

Complete field reference derived from `ai/stigmer/agentic/mcpserver/v1/spec.proto` and `status.proto`.

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # exact string — no variation allowed
kind: McpServer                      # PascalCase — must be exact
metadata: ...                        # See Metadata section
spec: ...                            # See Spec section
# status — NEVER set by users; system-managed only
```

## Metadata Fields

| Field | Required | Notes |
|---|---|---|
| `name` | **Yes** | Human-readable display name. Auto-generates `slug` if omitted. |
| `slug` | No | URL-safe identifier. Pattern: `^[a-z][a-z0-9-]*$`, 1–63 chars. Agents reference by this slug. If omitted, derived from `name`. |
| `org` | Recommended | Organization that owns this resource. Defaults to context org if omitted. Required in cloud mode. |
| `visibility` | No | `visibility_private` (default) or `visibility_public` (marketplace). |
| `labels` | No | Key-value map for filtering (e.g., `category: database`). |
| `annotations` | No | Key-value map for non-filtering metadata (e.g., `docs-url: "https://..."`). |
| `tags` | No | String array for categorization/search. |
| `id`, `version` | Never | System-generated. Never set by users. |

### Slug validation rules (enforced)
- Lowercase alphanumeric and hyphens only
- Must start with a letter
- 1–63 characters

```yaml
# Valid slugs
slug: github
slug: my-postgres-db
slug: internal-kb-v2

# Invalid — will fail validation
slug: GitHub          # uppercase
slug: my_db           # underscores
slug: 123-server      # starts with digit
```

### Visibility

```yaml
metadata:
  visibility: visibility_private   # only your org (default)
  visibility: visibility_public    # discoverable by any org (marketplace)
```

---

## Spec Fields

| Field | Required | Notes |
|---|---|---|
| `description` | Recommended | Shown in marketplace and UI. Explain what the server does. |
| `icon_url` | No | Publicly accessible SVG/PNG/JPEG URL. |
| `tags` | No | Domain tags (lowercase, hyphenated). Separate from `metadata.tags`. |
| `stdio` | **One required** | Subprocess server config. See below. |
| `http` | **One required** | HTTP server config. See below. |
| `default_enabled_tools` | No | Tool gate. Empty = all tools. Names must match server's `tools/list` exactly (case-sensitive). |
| `env_spec` | No | Credential contract. Schema only — no secret values here. |
| `default_tool_approvals` | No | Base-layer HITL approval policies. |

**Constraint:** exactly one of `stdio` or `http` must be present (`oneof server_type` with `required` validation). Omitting both or providing both fails validation.

---

## stdio Config

`StdioServerConfig` — spawns a subprocess; communicates over stdin/stdout.

| Field | Required | Notes |
|---|---|---|
| `command` | **Yes** | Binary name (resolved via PATH) or absolute path. Examples: `npx`, `python`, `node`, `./my-server`. |
| `args` | No | Arguments passed to the command. Order matters. |
| `working_dir` | No | Working directory. Use absolute paths for reliability. Inherits agent runner's cwd if omitted. |

```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

**Credential delivery:** env vars injected automatically from AgentInstance's environment binding. Declare them in `env_spec`.

---

## http Config

`HttpServerConfig` — connects to an already-running HTTP + SSE service.

| Field | Required | Notes |
|---|---|---|
| `url` | **Yes** | Valid HTTP/HTTPS URL (validated by buf.validate). |
| `headers` | No | HTTP headers sent with every request. Values support `${VAR_NAME}` substitution. |
| `query_params` | No | Query parameters. Values support `${VAR_NAME}` substitution. |
| `timeout_seconds` | No | 0–300 seconds. Default: 30. 0 = use default. |

```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"
    headers:
      Authorization: "Bearer ${API_TOKEN}"
      X-Tenant-ID: "${TENANT_ID}"
    timeout_seconds: 60
```

**Placeholder syntax in HTTP config:**
- `${VAR_NAME}` — resolved from AgentInstance environment at request time
- Do NOT use `{{args.field}}` in headers/params (that syntax is only for approval messages)

---

## env_spec

Declares required environment variables as a schema contract. Values are populated at runtime by the AgentInstance's environment binding.

```yaml
spec:
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub PAT with repo and read:org scopes"
        is_secret: true       # encrypted at rest, redacted in logs
      GITHUB_OWNER:
        description: "Default org or username (e.g., acme-corp)"
        is_secret: false      # plaintext, visible in audit logs
```

| Subfield | Notes |
|---|---|
| `description` | Required for usability — explains the required format and permissions. Be specific. |
| `is_secret` | `true` for tokens/keys/passwords. `false` for regions, IDs, non-sensitive config. |
| `value` | **Never pre-fill secrets here.** Leave empty; values come from AgentInstance at runtime. |

---

## default_enabled_tools

Platform-level tool gate. Agents can restrict further but cannot expand beyond this list.

```yaml
spec:
  default_enabled_tools:
    - execute_query       # tool names must match tools/list exactly
    - list_tables
    - describe_table
    # drop_table omitted — too destructive for defaults
```

- Empty list = all tools enabled (agents then restrict via `enabled_tools`)
- Non-empty list = agents can only use a subset of this list
- Tool names are case-sensitive; typos silently make the tool invisible
- **Always verify tool names via** `stigmer discover mcp-server <slug>` before populating

---

## default_tool_approvals

Base-layer HITL approval policies. Every agent using this server inherits these unless overridden.

```yaml
spec:
  default_tool_approvals:
    - tool_name: delete_repository       # exact name from tools/list (case-sensitive)
      message: "Delete repository: {{args.repo}}"
    - tool_name: force_push
      message: "Force push to {{args.branch}} on {{args.repo}}"
    - tool_name: drop_table
      message: "Drop table {{args.table_name}} in {{args.database}}"
```

### ToolApprovalPolicy fields

| Field | Required | Notes |
|---|---|---|
| `tool_name` | **Yes** | Exact tool name (case-sensitive). Minimum 1 char. Typos silently ignored — no approval applied. |
| `message` | No | Approval prompt shown to user. `{{args.field}}` placeholders resolved from tool call arguments. `{{tool_name}}` also available. If empty, system generates: `"Execute tool: {tool_name}"`. Keep under 100 chars. |

### Message template placeholders

| Syntax | Source | Context |
|---|---|---|
| `{{args.field_name}}` | Tool call arguments | Missing args → `<unknown>` |
| `{{tool_name}}` | Tool name | Always available |

**Correct:** `"Delete {{args.path}} from {{args.repository}}"`
**Wrong:** `"Delete ${args.path}"` — do not use `${}` in approval messages

### Approval policy chain (priority, lowest to highest)

1. `McpServer.default_tool_approvals` — baseline for all agents
2. `Agent.McpServerUsage.tool_approval_overrides` — per-agent add/remove
3. `AgentExecution.auto_approve_all: true` — runtime bypass (trusted pipelines)

---

## Status Fields (system-managed, never set by users)

| Field | Notes |
|---|---|
| `status.validation_state` | `valid`, `invalid`, or `validation_state_unspecified` |
| `status.validation_message` | Error details when `invalid` |
| `status.discovered_capabilities.tools[*].name` | **Authoritative tool names** — copy these for `default_enabled_tools` and `default_tool_approvals.tool_name` |
| `status.discovered_capabilities.tools[*].input_schema.properties` | Valid `{{args.field}}` names for approval messages |
| `status.audit` | Creation/modification audit trail |

---

## Validation Rules Summary

| Rule | Value |
|---|---|
| `apiVersion` | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Must be exactly `McpServer` (PascalCase) |
| `server_type` | Exactly one of `stdio` or `http` — required by oneof |
| `stdio.command` | Required when `stdio` is specified |
| `http.url` | Required, must be valid HTTP/HTTPS URI |
| `http.timeout_seconds` | 0–300 inclusive |
| `slug` | `^[a-z][a-z0-9-]*$`, 1–63 chars |
| Tool names | Case-sensitive, must match `tools/list` (typos silently ignored) |
| Secret values in spec | Never — schema only, values come from AgentInstance |
| Status fields | Never set by users |
