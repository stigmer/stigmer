# MCP Server Marketplace — Seedpack

## How the Marketplace is Populated

The Stigmer MCP marketplace is **curated by hand**. Each MCP server in
this directory is a vetted, high-quality definition that has been reviewed
for reliability, documentation quality, and active maintenance.

New servers are added as YAML files in this directory and bootstrapped
into the platform via `stigmer seedpack apply`.

## What Lives Here

- **`mcp-server-stigmer.yaml`** — The built-in Stigmer platform server,
  labeled `stigmer.ai/system: "true"`. Always present.
- **`mcp-server-{name}.yaml`** — One file per curated marketplace entry
  (e.g., `mcp-server-github.yaml`, `mcp-server-postgres.yaml`).

## Adding a New MCP Server

### Naming Convention

Files must be named `mcp-server-{name}.yaml` where `{name}` is a
lowercase, hyphenated identifier matching `metadata.name`.

### YAML Template

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: mcp-server-{name}
  visibility: visibility_public
  labels:
    stigmer.ai/category: "{category}"
  tags:
    - {tag1}
    - {tag2}
spec:
  description: "{One-line description of what this MCP server does.}"
  icon_url: "{URL to an SVG, PNG, or JPEG icon}"
  repository_url: "{GitHub repository URL}"
  github_stars: {star count at time of curation}
  stdio:
    command: "npx"
    args:
      - "-y"
      - "{npm-package-name}"
  env_spec:
    data:
      EXAMPLE_API_KEY:
        is_secret: true
        description: "{What this key is for}"
```

### Required Fields

| Field | Description |
|-------|-------------|
| `metadata.name` | `mcp-server-{name}`, unique across the seedpack |
| `metadata.visibility` | Always `visibility_public` for marketplace entries |
| `metadata.labels.stigmer.ai/category` | One of the categories listed below |
| `metadata.tags` | Lowercase, hyphenated tags for search and filtering |
| `spec.description` | Clear, concise explanation of capabilities |
| `spec.repository_url` | GitHub/GitLab URL to the source repository |
| `spec.stdio` or `spec.http` | Transport configuration (exactly one) |

### Optional Fields

| Field | Description |
|-------|-------------|
| `spec.icon_url` | Public URL to a server icon |
| `spec.github_stars` | Star count at time of curation (0 if unknown) |
| `spec.env_spec` | Environment variables the server requires |
| `spec.default_enabled_tools` | Subset of tools to enable by default |
| `spec.pinned_tool_approvals` | Manual approval policies for dangerous tools |

### Quality Bar

Before adding a server, verify:

1. The GitHub repository is **active** (commits within the last 6 months)
2. The server has **clear documentation** (README with setup instructions)
3. The server has a **stable transport** (stdio or HTTP, not experimental)
4. The npm/pip/binary package **installs and runs** without errors

### Categories

Use one of these values for `metadata.labels.stigmer.ai/category`:

| Category | Description |
|----------|-------------|
| `developer-tools` | Git, GitHub, GitLab, filesystem, code analysis |
| `databases` | PostgreSQL, MongoDB, Redis, MySQL, SQLite, hosted DBs |
| `search` | Web search, research APIs, content fetching |
| `cloud-infrastructure` | AWS, GCP, Cloudflare, Docker, Kubernetes, Terraform |
| `communication` | Slack, email, messaging platforms |
| `productivity` | Google Drive, Notion, calendar, note-taking |
| `web-automation` | Puppeteer, Playwright, browser control |
| `monitoring` | Sentry, logging, observability |
| `payments` | Stripe, Shopify, e-commerce |
| `design` | Figma, design tools |
| `ai-reasoning` | Sequential thinking, memory, AI-augmented tools |
| `notifications` | SMS, email delivery, push notifications |
| `scheduling` | Calendar, appointment, time management |
| `crm-support` | Salesforce, Jira, Zendesk, customer platforms |

## Proto Schema Reference

- [McpServer spec](../../apis/ai/stigmer/agentic/mcpserver/v1/spec.proto) —
  `McpServerSpec` with `repository_url` and `github_stars` for upstream provenance
- [Environment spec](../../apis/ai/stigmer/agentic/environment/v1/spec.proto) —
  `env_spec` declaration for server configuration
