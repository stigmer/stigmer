# Adding an MCP Server to the Marketplace

Step-by-step guide for adding new McpServer definitions to the Stigmer seedpack.

## Prerequisites

- The MCP server must be publicly available (npm, PyPI, or binary)
- The server must use environment variables for credentials (not positional args)
- You need the server's actual tool list (from documentation or discovery)

## Step 1: Research the Server

Find the following from the upstream source (npm page, GitHub README, MCP Registry):

| What | Where to look |
|------|---------------|
| Package name | npm / PyPI / GitHub releases |
| Environment variables | README "Configuration" or "Setup" section |
| Which env vars are secrets | Any tokens, keys, passwords = secret |
| Tool list | README "Tools" section, or run `stigmer discover` |
| Destructive tools | Any tool that writes, deletes, sends, or mutates |
| Icon URL | Project website favicon, GitHub org avatar, or brand assets |

## Step 2: Write the YAML

Create a file in `seedpack/mcp-servers/<name>.yaml` using this template:

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
    command: "npx"
    args:
      - "-y"
      - "<npm-package-name>"
  env_spec:
    data:
      ENV_VAR_NAME:
        is_secret: true
        description: "<what it is, format, required permissions/scopes>"
  default_tool_approvals:
    - tool_name: "<destructive-tool>"
      message: "<action verb> {{args.key_param}}"
```

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

- **env-var based credentials**: The server must read credentials from environment
  variables, not from positional CLI arguments. Servers that require per-user
  values in `args` (like connection URLs or directory paths) don't fit the
  blueprint model cleanly — the agent-runner passes args as-is without interpolation.
- **stdio or http transport**: The server must communicate via stdin/stdout (subprocess)
  or HTTP+SSE (remote).

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
