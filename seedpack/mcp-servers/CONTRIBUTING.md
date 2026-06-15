# MCP Server Marketplace — Seedpack

## How the Marketplace is Populated

The Stigmer MCP marketplace is **curated by hand**. Each MCP server in
this directory is a vetted, high-quality definition that has been reviewed
for reliability, documentation quality, and active maintenance.

New servers are added as YAML files in this directory and bootstrapped
into the platform via `stigmer seedpack apply`.

## What Lives Here

- **`stigmer.yaml`** — The built-in Stigmer platform server,
  labeled `stigmer.ai/system: "true"`. Always present.
- **`{slug}.yaml`** — One file per curated marketplace entry
  (e.g., `github.yaml`, `postgres.yaml`).

## Adding a New MCP Server

### Naming Convention

Three identifiers are in play, and they must line up:

1. **`metadata.name`** — the human-readable display name shown in the
   marketplace (e.g., `GitHub`, `Brave Search`).
2. **Slug** — derived automatically from `metadata.name` by lowercasing,
   replacing spaces with hyphens, and stripping non-alphanumerics
   (`GitHub` → `github`, `Brave Search` → `brave-search`). This is the
   stable identifier the platform stores and that everything else
   references. Do **not** set a slug manually.
3. **File name** — must be `{slug}.yaml` (e.g., `github.yaml`). The static
   tests and the canary `credential-manifest.yaml` (in `seedpack/canary/`) key
   off the file name.

> **Referencing a server from an agent.** An agent's `mcp_server_ref.slug`
> must be the **derived slug**, not the file name with any prefix. For a
> server named `GitHub`, the correct reference is `slug: github` — not
> `mcp-server-github`. A mismatched slug fails the `ValidateReferences`
> pipeline step at apply time with a `FailedPrecondition` error.

### YAML Templates

Four transport patterns are supported. Use exactly one of `spec.stdio` or
`spec.http` per server.

**stdio via npx (Node.js packages)**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: "{Display Name}"
  visibility: visibility_public
  labels:
    stigmer.ai/category: "{category}"
spec:
  description: "{One-line description of what this MCP server does.}"
  repository_url: "{GitHub repository URL}"
  github_stars: {star count at time of curation}
  tags:
    - {tag1}
    - {tag2}
  stdio:
    command: "npx"
    args:
      - "-y"
      - "{npm-package-name}"
  env:
    EXAMPLE_API_KEY:
      is_secret: true
      description: "{What this key is for}"
```

**stdio via uvx (Python packages)**

```yaml
spec:
  stdio:
    command: "uvx"
    args:
      - "{pypi-package-name}@latest"
      - "--url"
      - "${CONNECTION_URL}"
```

**stdio via go run (Go packages)**

```yaml
spec:
  stdio:
    command: "go"
    args:
      - "run"
      - "{go-module-path}@latest"
      - "stdio"
```

**HTTP (hosted/remote servers)**

```yaml
spec:
  http:
    url: "https://{mcp-endpoint-url}"
    headers:
      Authorization: "Bearer ${ACCESS_TOKEN}"
```

### Required Fields

| Field | Description |
|-------|-------------|
| `metadata.name` | Human-readable display name (e.g., `GitHub`), unique across the seedpack; its derived slug must match the file name |
| `metadata.visibility` | Always `visibility_public` for marketplace entries |
| `metadata.labels.stigmer.ai/category` | One of the categories listed below |
| `spec.description` | Clear, concise explanation of capabilities |
| `spec.tags` | Lowercase, hyphenated tags for marketplace search and filtering |
| `spec.repository_url` | GitHub/GitLab URL to the source repository (empty string for hosted-only servers) |
| `spec.stdio` or `spec.http` | Transport configuration (exactly one) |

### Optional Fields

| Field | Description |
|-------|-------------|
| `spec.icon_url` | Public URL to a server icon |
| `spec.github_stars` | Star count at time of curation (0 if unknown) |
| `spec.env` | Environment variable declarations (`EnvVarDeclaration`) the server requires. Each entry supports `is_secret`, `description`, and `optional` fields. |
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
| `databases` | PostgreSQL, MongoDB, Redis, MySQL, SQLite, Neon, Supabase |
| `search` | Web search, research APIs, content fetching |
| `cloud-infrastructure` | AWS, Cloudflare, Kubernetes, Terraform |
| `communication` | Slack, Linear, messaging platforms |
| `productivity` | Notion, Google Maps, note-taking, workspace tools |
| `web-automation` | Playwright, browser control and testing |
| `desktop-automation` | Open Computer Use, whole-desktop GUI control via OS accessibility APIs |
| `monitoring` | Sentry, logging, observability |
| `payments` | Stripe, e-commerce |
| `design` | Figma, design tools |
| `ai-reasoning` | Sequential thinking, memory, AI-augmented tools |
| `notifications` | Twilio, Resend, SMS, email delivery |
| `scheduling` | Google Calendar, time management |
| `crm-support` | Atlassian (Jira/Confluence), customer platforms |

## Proto Schema Reference

- [McpServer spec](../../apis/ai/stigmer/agentic/mcpserver/v1/spec.proto) —
  `McpServerSpec` with `repository_url` and `github_stars` for upstream provenance
- [Environment spec](../../apis/ai/stigmer/agentic/environment/v1/spec.proto) —
  `env` / `EnvVarDeclaration` for server configuration
