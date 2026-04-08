# Adding an MCP Server to the Marketplace

Step-by-step guide for adding new McpServer definitions to the Stigmer seedpack.

## Prerequisites

- The MCP server must be publicly available (npm, PyPI, binary, or hosted HTTP endpoint)
- The server must use environment variables, CLI arguments, or HTTP headers for configuration
- You need the server's actual tool list (from documentation or discovery)

## Step 1: Research the Server

Find the following from the upstream source (npm page, GitHub README, MCP Registry):

| What | Where to look |
|------|---------------|
| Package or endpoint | npm / PyPI / GitHub releases / vendor docs |
| Environment variables | README "Configuration" or "Setup" section |
| Which env vars are secrets | Any tokens, keys, passwords = secret |
| Tool list | README "Tools" section, or run `stigmer discover` |
| Destructive tools | Any tool that writes, deletes, sends, or mutates |
| Icon URL | Project website favicon, GitHub org avatar, or brand assets |

## Step 2: Write the YAML

Create a file in `seedpack/mcp-servers/<name>.yaml`. Choose the template that
matches the server's transport type.

### Template: stdio server (subprocess)

Most MCP servers run as local subprocesses communicating via stdin/stdout.
The agent-runner supports three common runtimes:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: <upstream-name>
  visibility: visibility_public
  labels:
    stigmer.ai/category: "<category>"
  tags:
    - <tag1>
    - <tag2>
spec:
  description: "<what it does — 1 sentence, purpose-driven>"
  icon_url: "<publicly accessible icon URL>"
  stdio:
    command: "npx"            # or "uvx" (Python) or "go" (Go modules)
    args:
      - "-y"
      - "<npm-package-name>"
      # Args can use ${VAR_NAME} for servers that take config as CLI arguments:
      # - "${CONNECTION_URL}"
  env_spec:
    data:
      ENV_VAR_NAME:
        is_secret: true
        description: "<what it is, format, required permissions/scopes>"
  default_tool_approvals:
    - tool_name: "<destructive-tool>"
      message: "<action verb> {{args.key_param}}"
```

**Runtime examples:**

| Runtime | command | args example |
|---------|---------|--------------|
| npm (Node.js) | `npx` | `["-y", "@modelcontextprotocol/server-slack"]` |
| PyPI (Python) | `uvx` | `["mcp-server-sqlite", "--db-path", "${DB_PATH}"]` |
| Go modules | `go` | `["run", "github.com/org/server@latest", "stdio"]` |

### Template: HTTP server (remote)

Some MCP servers are hosted services accessible over HTTP (Streamable HTTP
transport). These use `spec.http` instead of `spec.stdio`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: <upstream-name>
  visibility: visibility_public
  labels:
    stigmer.ai/category: "<category>"
  tags:
    - <tag1>
    - <tag2>
spec:
  description: "<what it does — 1 sentence, purpose-driven>"
  icon_url: "<publicly accessible icon URL>"
  http:
    url: "<MCP endpoint URL>"
    headers:
      Authorization: "Bearer ${API_KEY}"
  env_spec:
    data:
      API_KEY:
        is_secret: true
        description: "<what it is, format, required permissions/scopes>"
  default_tool_approvals:
    - tool_name: "<destructive-tool>"
      message: "<action verb> {{args.key_param}}"
```

Header and query param values support `${VAR_NAME}` placeholders, resolved
from the same `env_spec` pool as stdio args. Unresolved placeholders in HTTP
configs log a warning (lenient mode) rather than failing hard.

### Naming

- `metadata.name`: Use whatever name the upstream source uses (repo name, registry name).
  Do not append "MCP Server". Examples: `github`, `slack`, `brave-search`.
- `metadata.slug`: Omit — auto-generated from name.
- `metadata.org`: Omit — auto-resolved from the seedpack project manifest.

### Categories

Set `metadata.labels.stigmer.ai/category` to exactly one of:

| Category | Examples |
|----------|----------|
| `developer` | GitHub, GitLab, Linear, Jira |
| `database` | PostgreSQL, SQLite, MySQL, MongoDB |
| `communication` | Slack, Discord, Gmail |
| `productivity` | Notion, Google Drive, Google Calendar |
| `cloud` | AWS, Kubernetes |
| `observability` | Sentry, Datadog |
| `search` | Brave Search |
| `utility` | Fetch, Puppeteer |

### Tags

Use `metadata.tags` (not `spec.tags`) for marketplace search. Include 2-5
lowercase, hyphenated terms that describe the server's domain and capabilities.

### Environment Variables

- Declare every env var the server needs in `env_spec.data`
- Set `is_secret: true` for tokens, keys, and passwords
- Never set `value` for secrets
- Write descriptions that tell users exactly what to create and what permissions/scopes to grant

`env_spec` is the universal declaration of what the server needs from the user,
regardless of how the server consumes those values. The agent-runner delivers
declared env vars through three mechanisms:

1. **Process environment** (stdio) — all declared keys are set in the subprocess `env`
2. **Argument interpolation** (stdio) — args containing `${VAR_NAME}` are resolved
   from the same pool before the subprocess starts
3. **Header/query param interpolation** (http) — `${VAR_NAME}` placeholders in
   `headers` and `query_params` are resolved before each request

This means servers that read configuration from positional CLI arguments
(e.g. PostgreSQL connection URL, Filesystem paths), environment variables
(e.g. MongoDB connection string), or HTTP headers (e.g. Linear API key)
can all be parameterized the same way. From the user's perspective, the
`EnvVarForm` experience is identical in all cases.

### Tool Approvals

Add `default_tool_approvals` entries for tools that:
- Delete or destroy resources
- Write, modify, or overwrite data
- Send messages, emails, or notifications
- Execute arbitrary commands

Use `{{args.field}}` placeholders for context-rich approval messages.
Keep messages under 100 characters. Use action verbs.

### What NOT to Include

| Field | Reason |
|-------|--------|
| `metadata.slug` | Auto-generated from name |
| `metadata.org` | Auto-resolved from project manifest |
| `metadata.annotations` | Add only when marketplace UI consumes them |
| `spec.tags` | Use `metadata.tags` instead |
| `spec.default_enabled_tools` | Empty = all tools; agents restrict per use case |
| `status` | System-managed |
| `stigmer.ai/system` label | Reserved for built-in system servers |

## Step 3: Validate

```bash
stigmer validate -f seedpack/mcp-servers/<name>.yaml
```

Must pass with no errors.

## Step 4: Discover Capabilities

With a running stigmer-server:

```bash
# Apply the definition
stigmer apply -f seedpack/mcp-servers/<name>.yaml

# Discover tools (dry-run first to preview)
stigmer discover mcp-server <name> --dry-run --env KEY=value

# Push capabilities to server
stigmer discover mcp-server <name> --env KEY=value

# Verify
stigmer get mcp-server <name> --output yaml
```

Discovery runs locally — credentials never leave your machine.

## Step 5: Verify Tool Names

After discovery, check `status.discovered_capabilities.tools` in the output.
Make sure every `tool_name` in `default_tool_approvals` matches exactly
(case-sensitive). Unmatched names are silently ignored — no error, no approval enforced.

## Compatibility Check

Before adding a server, verify it fits the Stigmer marketplace model:

- **Parameterizable via env_spec**: All per-user configuration (credentials,
  connection URLs, paths) must be declarable in `env_spec.data`. The server can
  consume these values via process environment variables or via `${VAR}` placeholders
  in stdio args — both are supported.
- **stdio or http transport**: The server must communicate via stdin/stdout (subprocess)
  or HTTP+SSE (remote).

### Security note on `${VAR}` in stdio args

Resolved values in stdio args appear in the subprocess `argv`, which is visible
via `/proc/<pid>/cmdline` within the same container. In the containerized
agent-runner environment this is not a practical risk (single process per
container), but it differs from process `env` which is restricted to
`/proc/<pid>/environ` (same-user access only). For maximum isolation,
prefer servers that read secrets from environment variables when possible.

## Reference

- [McpServer proto schema](../../apis/ai/stigmer/agentic/mcpserver/v1/spec.proto)
- [Validation rules](../skills/mcp-server-creator/references/validation.md)
- [Full examples](../skills/mcp-server-creator/references/examples.md)
- [Agent integration](../skills/mcp-server-creator/references/agent-integration.md)

## Where to Find MCP Servers

| Source | URL |
|--------|-----|
| Official MCP Registry | https://registry.modelcontextprotocol.io/v0.1/servers |
| Reference implementations | https://github.com/modelcontextprotocol/servers |
| npm packages | Search `@modelcontextprotocol` on https://www.npmjs.com |
| Community directory | https://github.com/punkpeye/awesome-mcp-servers |
