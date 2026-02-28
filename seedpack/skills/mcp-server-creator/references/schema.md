# McpServer YAML Schema Reference

## Top-Level Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # exact string — required
kind: McpServer                      # PascalCase — required
metadata: ...                        # see Metadata Fields
spec: ...                            # see Spec Fields
# status: omit entirely, or leave as {}  — NEVER set by users
```

---

## Metadata Fields

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Human-readable display name (e.g., `"GitHub MCP Server"`) |
| `slug` | No | URL-safe ID, auto-generated from `name` if omitted. Format: `^[a-z][a-z0-9-]*$`, max 63 chars. This is what agents use in `mcp_server_ref.slug`. |
| `org` | Depends | `local` for local mode. Required in cloud mode (your org slug). |
| `visibility` | No | `visibility_private` (default) or `visibility_public` (marketplace only) |
| `labels` | No | Key-value map for filtering (e.g., `category: vcs`) |
| `annotations` | No | Key-value map for non-filtering metadata (e.g., `docs-url: "https://..."`) |
| `tags` | No | String array for search and categorization |

**Slug rules:** lowercase, hyphens only, starts with a letter, 1–63 chars.
```
✓  github   github-mcp   my-internal-db-v2
✗  GitHub   github_mcp   123-github   GitHub-MCP-Server
```

---

## Spec Fields

| Field | Required | Notes |
|---|---|---|
| `description` | Recommended | What this server does; shown in marketplace and agent config UI |
| `icon_url` | No | Publicly accessible SVG/PNG/JPEG URL |
| `tags` | No | Separate from `metadata.tags`; describe domain/capabilities |
| `stdio` | Conditionally required | Use for subprocess-based servers (most MCP servers) |
| `http` | Conditionally required | Use for remote/hosted HTTP services |
| `default_enabled_tools` | No | Tools available by default; empty = all tools enabled |
| `env_spec` | No | Schema of required env vars; never pre-fill secret values |
| `default_tool_approvals` | No | Tools requiring user approval by default |

**Exactly one of `stdio` or `http` must be present.** Omitting both or specifying both fails validation.

---

## Stdio Config (`spec.stdio`)

Use for: npx packages, `python -m` modules, Go/Rust binaries, any CLI-based MCP server.

| Field | Required | Notes |
|---|---|---|
| `command` | Yes | Executable name (on `PATH`) or absolute path |
| `args` | No | Array of arguments; order matters |
| `working_dir` | No | Use absolute paths only if specified |

**Credential injection:** environment variables from `env_spec` are passed directly to the subprocess — no additional config needed.

```yaml
# Node.js via npx
stdio:
  command: npx
  args: ["-y", "@modelcontextprotocol/server-github"]

# Python module
stdio:
  command: python
  args: ["-m", "mcp_server_sqlite", "--db-path", "/data/db.sqlite"]

# Custom binary
stdio:
  command: ./mcp-server
  working_dir: /opt/my-mcp-server
  args: ["--config", "config.yaml"]
```

---

## HTTP Config (`spec.http`)

Use for: managed/hosted MCP services, servers behind API gateways, shared multi-agent services.

| Field | Required | Notes |
|---|---|---|
| `url` | Yes | Valid HTTP or HTTPS URL |
| `headers` | No | Key-value map; values support `${VAR_NAME}` env substitution |
| `query_params` | No | Key-value map; values support `${VAR_NAME}` env substitution |
| `timeout_seconds` | No | Range 0–300; default 30 |

**Placeholder syntax:** `${VAR_NAME}` in headers/params is resolved from the AgentInstance environment at runtime. **Never use `{{args.field}}` here** — that syntax is only for approval messages.

```yaml
http:
  url: "https://mcp.example.com/v1"
  headers:
    Authorization: "Bearer ${API_TOKEN}"
    X-Tenant-ID: "${TENANT_ID}"
  timeout_seconds: 60
```

**Timeout guidance:**

| Use Case | Timeout |
|---|---|
| Simple lookups | 30s (default) |
| Background work | 60–120s |
| Long data processing | 180–300s |

---

## Environment Variables (`spec.env_spec`)

Declares the **schema** of required env vars — not the values. Values are provided at runtime via AgentInstance environment binding. Never pre-fill secrets.

```yaml
env_spec:
  data:
    GITHUB_TOKEN:
      description: "GitHub PAT with repo and read:org scopes"
      is_secret: true        # encrypted at rest, redacted in logs
    GITHUB_OWNER:
      description: "Default GitHub org or username (e.g., acme-corp)"
      is_secret: false       # plaintext, visible in audit logs
      # value: ""            # leave empty for secrets; may pre-fill non-secret shared defaults
```

**`is_secret` decision rule:** Anything that grants access, could be abused if leaked, or is unique per-user → `true`. Shared configuration values with no security risk → `false`.

---

## Default Enabled Tools (`spec.default_enabled_tools`)

The McpServer-level tool gate. Empty list = all tools available. Non-empty list = only listed tools are available to agents (agents can only restrict further, never expand).

```yaml
default_enabled_tools:
  - search_code
  - get_file_contents
  - list_issues
  - create_pull_request
  # delete_repository omitted — too dangerous for defaults
```

**Tool names must match exactly** (case-sensitive) what the server reports via `tools/list`. Unmatched names are silently ignored. Always verify via discovery:
```bash
stigmer mcp-server apply mcpserver.yaml
stigmer discover mcp-server <slug>
stigmer mcp-server get <slug> --output yaml   # copy from status.discovered_capabilities.tools[*].name
```

---

## Default Tool Approvals (`spec.default_tool_approvals`)

Base layer of the approval policy chain. Applied to every agent referencing this server.

```yaml
default_tool_approvals:
  - tool_name: delete_repository          # exact name from tools/list
    message: "Delete repository: {{args.repo}}"
  - tool_name: merge_pull_request
    message: "Merge PR #{{args.pull_number}} in {{args.repo}}"
```

**Message template placeholders:**
- `{{args.field_name}}` — resolved from tool call arguments at invocation time. If missing, renders as `<unknown>`.
- `{{tool_name}}` — always available, renders as the tool's name.

**Message guidelines:** Be specific, include high-risk arguments, use action verbs, stay under 100 chars.

**Silent failure:** A typo in `tool_name` silently disables the approval. Always copy names from `status.discovered_capabilities.tools[*].name`.

---

## Tool Approval Policy Chain

```
McpServer.default_tool_approvals        (lowest — platform defaults)
        ↓ can override per agent
Agent.McpServerUsage.tool_approval_overrides
        ↓ can bypass entirely
AgentExecution.auto_approve_all         (highest — runtime bypass)
```

---

## Placeholder Syntax Quick Reference

| Syntax | Where | Resolved By | Example |
|---|---|---|---|
| `${VAR_NAME}` | HTTP `headers` / `query_params` values | Agent runner from env binding | `"Bearer ${API_TOKEN}"` |
| `{{args.field}}` | `default_tool_approvals.message` | Approval engine from tool args | `"Delete {{args.repo}}"` |

**Never swap these.** `${...}` in approval messages won't resolve. `{{...}}` in HTTP headers won't resolve.
