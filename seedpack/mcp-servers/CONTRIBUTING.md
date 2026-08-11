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

**The seedpack catalog is HTTP-only.** Stdio MCP servers run only on local
runners (they spawn subprocesses on the machine executing the agent), so
they are not shipped in the marketplace — a cloud-targeted session that
references one is refused at execution create. The `stdio` transport itself
remains fully supported for **user-defined** servers on local runners; it is
only the curated catalog that requires a hosted HTTP endpoint. If the vendor
does not offer one, the server does not belong in the seedpack.

**Use the vendor's streamable HTTP endpoint, never a legacy `/sse` one.** The
MCP spec deprecated the HTTP+SSE transport in 2025-03-26, and vendors are
retiring their `/sse` paths (Webflow's retirement broke connect outright —
stigmer/stigmer#238). Stigmer's client stack is streamable-first by
construction: the Go discovery transport is streamable-HTTP-only, and the
runner's SSE fallback is a fragile compatibility path (stigmer/stigmer#231).
When a vendor documents both, always take the streamable HTTP URL (typically
`/mcp`). Endpoints known to be retired or deprecated are denylisted in
`TestMcpServers_NoRetiredEndpoints`.

**HTTP (hosted/remote servers)**

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
  http:
    url: "https://{mcp-endpoint-url}"
    headers:
      Authorization: "Bearer ${ACCESS_TOKEN}"
  env:
    ACCESS_TOKEN:
      is_secret: true
      description: "{What this token is for}"
```

> **Auth header convention (enforced).** An OAuth-managed HTTP server — one with
> an `auth` block — must present its token as `Authorization: "Bearer ${target_env_var}"`.
> This is what the MCP Authorization spec requires on the wire. A custom,
> env-var-named header (e.g. `MONDAY_TOKEN: "${MONDAY_ACCESS_TOKEN}"`) is the
> stdio convention: it works as a subprocess env var but silently fails against a
> remote OAuth endpoint, which ignores the unknown header (stigmer/stigmer#147).
> The `TestMcpServers_OAuthTokenHeaderIsBearer` static test enforces this. Static-key
> HTTP servers with no `auth` block are free to use other schemes (e.g. `Token`).

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
| `spec.auth` | OAuth configuration for automated credential acquisition (see below) |

### OAuth authentication (`spec.auth`)

Add a `spec.auth` block when the server authenticates via OAuth. Stigmer then
offers a "Sign in" flow on the Connect page and stores the acquired token in a
system-managed environment, injecting it into the header via `target_env_var`.

There are two OAuth modes, chosen by whether `oauth_app_ref` is set:

```yaml
spec:
  http:
    url: "https://mcp.example.com/mcp"
    headers:
      Authorization: "Bearer ${EXAMPLE_ACCESS_TOKEN}"
  env:
    EXAMPLE_ACCESS_TOKEN:
      is_secret: true
      description: "OAuth access token, obtained automatically via Connect."
  auth:
    # target_env_var must match a spec.env key: it is both the allowlist that
    # lets the managed OAuth token reach the header AND where the token is stored.
    target_env_var: "EXAMPLE_ACCESS_TOKEN"
    token_lifetime_hint: "1h"     # optional, informational
    # oauth_only: set true ONLY when the endpoint rejects manually-entered
    # static tokens (personal API tokens / PATs). It hides the "enter token
    # manually" option so users are not sent down a path that cannot succeed.
    # Leave unset (false) for API-key servers and vendors that also accept a PAT.
    oauth_only: true
    # oauth_app_ref: set ONLY for vendor OAuth (a pre-registered platform
    # OAuthApp, e.g. GitHub/Slack). Omit for MCP-spec DCR servers, which
    # Stigmer discovers and registers automatically from the http.url.
    # oauth_app_ref:
    #   org: stigmer
    #   kind: oauth_app
    #   slug: example-oauth
```

> **Keep `spec.env` even for `oauth_only` servers.** The declaration is the
> allowlist that permits the managed OAuth token to be injected into the header
> at execution time. Removing it makes the connected server silently drop out of
> the agent's toolset.

### Quality Bar

Before adding a server, verify:

1. The GitHub repository is **active** (commits within the last 6 months)
2. The server has **clear documentation** (README with setup instructions)
3. The server has a **stable hosted HTTP endpoint** (the catalog is HTTP-only; stdio servers are local-runner-only and not curated)
4. The endpoint **responds to MCP protocol requests** without errors

### Categories

Use one of these values for `metadata.labels.stigmer.ai/category`:

| Category | Description |
|----------|-------------|
| `developer-tools` | GitHub, GitLab, code analysis |
| `databases` | Neon, Supabase, MongoDB Atlas, hosted database platforms |
| `search` | Web search, research APIs, content fetching |
| `cloud-infrastructure` | Cloudflare, Netlify, hosting and infra platforms |
| `communication` | Slack, Linear, messaging platforms |
| `productivity` | Notion, Google Maps, note-taking, workspace tools |
| `monitoring` | Sentry, Datadog, logging, observability |
| `payments` | Stripe, PayPal, Square, e-commerce |
| `design` | Figma, Canva, design tools |
| `crm-support` | Atlassian (Jira/Confluence), HubSpot, Intercom, customer platforms |

## Proto Schema Reference

- [McpServer spec](../../apis/ai/stigmer/agentic/mcpserver/v1/spec.proto) —
  `McpServerSpec` with `repository_url` and `github_stars` for upstream provenance
- [Environment spec](../../apis/ai/stigmer/agentic/environment/v1/spec.proto) —
  `env` / `EnvVarDeclaration` for server configuration
