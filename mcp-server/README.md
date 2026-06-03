# Stigmer MCP Server

A stateless [MCP](https://modelcontextprotocol.io) gateway that connects
AI-powered IDEs to [Stigmer](https://github.com/stigmer/stigmer). It translates
MCP tool calls and resource reads into gRPC requests against a running
`stigmer-server`, letting Cursor, Claude Desktop, VS Code, and Windsurf search,
inspect, and manage agents, skills, workflows, and MCP server definitions
without leaving the editor.

```
AI IDE (Cursor / Claude Desktop / VS Code / Windsurf)
     ↕  MCP protocol (stdio or Streamable HTTP)
mcp-server-stigmer
     ↕  gRPC (TLS on :443, plaintext otherwise)
stigmer-server
```

This server does not store state. It is a protocol bridge: every tool call opens
a short-lived gRPC connection, performs the RPC, and returns the result. It can
serve both STDIO and HTTP transports concurrently from a single process.

---

## Key Concepts

| Term | Definition |
|------|------------|
| **org** | Organization slug — the tenant-level namespace that owns a resource (e.g. `acme`). |
| **slug** | URL-safe unique identifier for a resource within an org (e.g. `code-reviewer`). |
| **agent** | An AI agent definition: model, instructions, skills, and MCP servers it can use. |
| **skill** | A versioned knowledge artifact (instructions + reference material). Read-only via MCP — see [Why no apply_skill?](#why-no-apply_skill). |
| **workflow** | An orchestration definition: tasks, branching, environment, and execution rules. |
| **MCP server** | A registered external tool server definition that agents can connect to. |
| **apply** | Idempotent create-or-update. Same semantics as `kubectl apply` — if the resource exists it is updated, otherwise it is created. |
| **`stigmer://` URI** | Resource identifier in the form `stigmer://{kind}/{org}/{slug}[/{version}]`. The `search` tool returns these in each result so clients can call `resources/read` directly. |

---

## Installation

### Prerequisites

1. A running `stigmer-server` — local via `stigmer server` or
   [Stigmer Cloud](https://stigmer.ai)
2. A compatible MCP host (Cursor, Claude Desktop, VS Code, Windsurf, or any
   MCP-compliant client)

### Stigmer CLI (recommended)

No separate binary needed. If you already have the CLI installed:

```bash
stigmer mcp-server
```

Connection settings are auto-resolved from `~/.stigmer/config.yaml`.

### Go Install

```bash
go install github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest
```

### Docker

```bash
docker run -i --rm \
  -e STIGMER_SERVER_ADDRESS=api.stigmer.ai:443 \
  -e STIGMER_API_KEY=your-api-key \
  ghcr.io/stigmer/mcp-server-stigmer
```

> **Docker networking:** `localhost` inside a container refers to the
> container's own loopback, not the host machine. To reach a `stigmer-server`
> running on the host, use `host.docker.internal` on Docker Desktop
> (macOS / Windows) or add `--network host` on Linux.

### Build from Source

```bash
git clone https://github.com/stigmer/stigmer.git
cd stigmer/mcp-server
make build
./bin/mcp-server-stigmer
```

---

## MCP Client Configuration

All MCP clients use the same JSON structure. The differences are the config file
location and the top-level key.

### Using the standalone binary or Go install

```json
{
  "mcpServers": {
    "stigmer": {
      "command": "mcp-server-stigmer",
      "env": {
        "STIGMER_SERVER_ADDRESS": "localhost:7234",
        "STIGMER_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Using the Stigmer CLI

```json
{
  "mcpServers": {
    "stigmer": {
      "command": "stigmer",
      "args": ["mcp-server"]
    }
  }
}
```

No `env` block is needed — the CLI reads `~/.stigmer/config.yaml`
automatically.

### Using Docker

```json
{
  "mcpServers": {
    "stigmer": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "STIGMER_SERVER_ADDRESS",
        "-e", "STIGMER_API_KEY",
        "ghcr.io/stigmer/mcp-server-stigmer"
      ],
      "env": {
        "STIGMER_SERVER_ADDRESS": "localhost:7234",
        "STIGMER_API_KEY": "your-api-key"
      }
    }
  }
}
```

### VS Code / GitHub Copilot

VS Code uses `"servers"` instead of `"mcpServers"` as the top-level key:

```json
{
  "servers": {
    "stigmer": {
      "command": "stigmer",
      "args": ["mcp-server"]
    }
  }
}
```

### Where to put the config

| Client | Config file | Top-level key |
|--------|-------------|---------------|
| Cursor | `.cursor/mcp.json` (workspace) or global settings | `mcpServers` |
| Claude Desktop / Claude Code | `claude_desktop_config.json` | `mcpServers` |
| VS Code / GitHub Copilot | `.vscode/mcp.json` (workspace) or user settings | `servers` |
| Windsurf | Windsurf MCP settings | `mcpServers` |

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `STIGMER_SERVER_ADDRESS` | `localhost:7234` | gRPC dial target for `stigmer-server`. |
| `STIGMER_API_KEY` | *(none)* | API key for authenticated backends. Auto-resolved when running via `stigmer mcp-server`. Required for Stigmer Cloud. Optional for unauthenticated local backends. |
| `STIGMER_MCP_TRANSPORT` | `stdio` | Transport mode: `stdio`, `http`, or `both`. |
| `STIGMER_MCP_HTTP_PORT` | `8080` | TCP port for the HTTP transport. |
| `STIGMER_MCP_HTTP_AUTH_ENABLED` | `true` | Require `Authorization: Bearer <token>` on HTTP requests. |
| `STIGMER_MCP_LOG_FORMAT` | `text` | Log encoding: `text` or `json`. Logs are written to stderr. |
| `STIGMER_MCP_LOG_LEVEL` | `info` | Minimum log severity: `debug`, `info`, `warn`, or `error`. |

When running via `stigmer mcp-server`, the CLI resolves settings from
`~/.stigmer/config.yaml` before falling back to environment variables. The
standalone binary and Docker image use environment variables only.

**TLS:** Connections to endpoints on port `443` automatically use TLS with the
system root CA pool. All other ports use plaintext. There is no separate TLS
configuration flag.

---

## Tools

### search

Unified search and discovery across all Stigmer resource kinds.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | no | Free-text search string. Omit to list all accessible resources. |
| `kinds` | no | Filter by resource type. Valid values: `agent`, `skill`, `mcp_server`, `workflow`. Omit to search all kinds. |
| `org` | no | Scope results to a single organization slug. Omit to search across all accessible orgs. |
| `exclude_public` | no | When `true`, hides platform-provided public resources from results. Default `false`. |
| `page_size` | no | Results per page (default 20, max 100). |
| `page_num` | no | Page number, 1-indexed (default 1). |

**Usage patterns:**

```jsonc
// List all agents in an org
{"kinds": ["agent"], "org": "acme"}

// Full-text search across everything
{"query": "kubernetes"}

// Filtered search with pagination
{"kinds": ["agent", "skill"], "query": "security", "org": "acme", "page_size": 10}
```

Each result includes a `resource_uri` field (e.g.
`stigmer://agents/acme/code-reviewer`) that can be passed directly to
`resources/read`.

### get_agent

Retrieve the full definition of an agent.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug (e.g. `stigmer`). |
| `slug` | **yes** | Agent slug (e.g. `code-reviewer`). |

### get_skill

Retrieve the full definition of a skill, optionally at a specific version.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug. |
| `slug` | **yes** | Skill slug. |
| `version` | no | Tag name (e.g. `stable`, `v1.0`) or SHA-256 content hash. Omit for the latest version. |

### get_workflow

Retrieve the full definition of a workflow.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug. |
| `slug` | **yes** | Workflow slug. |

### get_mcp_server

Retrieve the full definition of an MCP server.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug. |
| `slug` | **yes** | MCP server slug. |

### apply_agent

Create or update an agent definition (idempotent).

| Parameter | Required | Description |
|-----------|----------|-------------|
| *(structured)* | **yes** | Full agent specification — identity fields (name, org) and configuration (instructions, skills, MCP servers, etc.). The input schema is auto-generated from the Agent protobuf definition. |

### apply_workflow

Create or update a workflow definition (idempotent).

| Parameter | Required | Description |
|-----------|----------|-------------|
| *(structured)* | **yes** | Full workflow specification — identity fields (name, org) and configuration (document, tasks, env, etc.). The input schema is auto-generated from the Workflow protobuf definition. |

### apply_mcp_server

Create or update an MCP server definition (idempotent).

| Parameter | Required | Description |
|-----------|----------|-------------|
| *(structured)* | **yes** | Full MCP server specification — identity fields (name, org) and configuration (stdio/http, tools, env, etc.). The input schema is auto-generated from the McpServer protobuf definition. |

### delete_agent

Delete an agent by org and slug. Returns the deleted agent definition.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug. |
| `slug` | **yes** | Agent slug. |

### delete_skill

Delete a skill and **all its versions** by org and slug. Returns the deleted
skill definition.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug. |
| `slug` | **yes** | Skill slug. |

### delete_workflow

Delete a workflow by org and slug. Returns the deleted workflow definition.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug. |
| `slug` | **yes** | Workflow slug. |

### delete_mcp_server

Delete an MCP server definition by org and slug. Returns the deleted definition.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `org` | **yes** | Organization slug. |
| `slug` | **yes** | MCP server slug. |

### Why no apply_skill?

Skills are versioned knowledge artifacts. Each version is content-addressed
(SHA-256) and can be tagged (e.g. `stable`, `v1.0`). This versioning model
requires the `stigmer skill push` CLI command, which handles content hashing,
diffing, and tag management. The MCP server exposes skills as **read-only**
resources — you can search, fetch, and delete them, but creation and updates go
through the CLI.

### Error handling

All tools translate gRPC errors into user-friendly messages:

| gRPC Status | Tool Error Message |
|-------------|-------------------|
| `NotFound` | `{resource} not found. Verify the org and slug are correct.` |
| `PermissionDenied` | `Permission denied for {resource}. Check your API key permissions.` |
| `Unauthenticated` | `Authentication failed. Check your API key.` |
| `Unavailable` | `Stigmer server is unavailable. Ensure it is running and reachable.` |
| `DeadlineExceeded` | `Request timed out contacting stigmer-server.` |
| `InvalidArgument` | The server's validation message is returned directly. |

---

## Resources

MCP clients can read Stigmer resources directly by URI via `resources/read`.

| URI Template | Description | MIME Type |
|--------------|-------------|-----------|
| `stigmer://agents/{org}/{slug}` | Agent definition | `application/json` |
| `stigmer://mcp-servers/{org}/{slug}` | MCP server definition | `application/json` |
| `stigmer://skills/{org}/{slug}` | Skill definition (latest version) | `application/json` |
| `stigmer://skills/{org}/{slug}/{version}` | Skill definition at a specific version | `application/json` |
| `stigmer://workflows/{org}/{slug}` | Workflow definition | `application/json` |

The `search` tool returns a `resource_uri` in each result that can be passed
directly to `resources/read` — no manual URI construction is needed.

**URI structure:** `stigmer://{kind-plural}/{org}/{slug}[/{version}]`

The kind-to-path mapping is:

| Kind (singular) | URI Authority (plural) |
|-----------------|----------------------|
| `agent` | `agents` |
| `mcp_server` | `mcp-servers` |
| `skill` | `skills` |
| `workflow` | `workflows` |

---

## HTTP Mode

For shared or remote deployments, set the transport to `http`. This runs the
MCP Streamable HTTP transport — not a REST API.

```bash
STIGMER_MCP_TRANSPORT=http \
STIGMER_SERVER_ADDRESS=api.stigmer.ai:443 \
STIGMER_API_KEY=your-api-key \
  mcp-server-stigmer
```

Or with Docker:

```bash
docker run --rm \
  -e STIGMER_SERVER_ADDRESS=api.stigmer.ai:443 \
  -e STIGMER_API_KEY=your-api-key \
  -e STIGMER_MCP_TRANSPORT=http \
  -p 8080:8080 \
  ghcr.io/stigmer/mcp-server-stigmer
```

Connect your MCP client to `http://host:8080` with an
`Authorization: Bearer <token>` header, where `<token>` is a valid Stigmer API
key. Each HTTP request carries its own API key, so multiple users can share a
single server instance.

**Auth:** HTTP auth is enabled by default. Set
`STIGMER_MCP_HTTP_AUTH_ENABLED=false` only for trusted internal networks where
all callers are already authenticated at the network level.

**Dual transport:** Set `STIGMER_MCP_TRANSPORT=both` to serve STDIO and HTTP
simultaneously from a single process. This is useful in development when you
want local IDE access (STDIO) and remote access (HTTP) at the same time.

**TLS:** The HTTP transport does not terminate TLS natively. For production
deployments, place a TLS-terminating reverse proxy (e.g. nginx, Envoy, or a
cloud load balancer) in front of the MCP server.

---

## Hosted Remote Server

Stigmer Cloud runs this server as a hosted, network-reachable MCP endpoint at:

```
https://mcp.stigmer.ai
```

It runs in `http` transport mode behind the Planton-managed ingress (which
terminates TLS), and forwards every request to the in-cluster `stigmer-server`.

### Authentication is provider-agnostic

The server does **not** assume any particular identity provider. It takes the
`Authorization: Bearer <token>` header and forwards it unchanged to
`stigmer-server`, which validates it. A valid `<token>` is any of:

- a Stigmer API key (`stk_…`) created with `stigmer apikey create`,
- an access token issued by your organization's own IdP (the same token the web
  console uses), or
- a Stigmer-issued platform-client token.

This is why there is no built-in OAuth flow: a single hardwired authorization
server would only work for one IdP and would break bring-your-own-IdP orgs.

### Connecting a client

Any MCP client that lets you set a request header works:

```jsonc
// Clients that support remote HTTP MCP servers with custom headers
{
  "mcpServers": {
    "stigmer": {
      "url": "https://mcp.stigmer.ai",
      "headers": { "Authorization": "Bearer stk_your_api_key" }
    }
  }
}
```

The hosted endpoint is also published as the built-in marketplace entry,
[`seedpack/mcp-servers/stigmer.yaml`](../seedpack/mcp-servers/stigmer.yaml),
so Stigmer agents can connect to it via `mcp_server_usages`.

> **Claude Desktop note:** Claude Desktop's "Add custom connector" GUI expects a
> full OAuth 2.0 handshake from the remote server. Because this server uses
> Bearer-token passthrough (not a single-issuer OAuth flow), use a client that
> supports a manually-supplied `Authorization` header. Native OAuth-GUI support
> would require an issuer-agnostic OAuth layer and is intentionally out of scope.

### Deployment

The hosted service follows the same split-repo pattern as `stigmer-web`:

- **Runtime manifests (this repo):**
  [`mcp-server/_kustomize/`](_kustomize/) — `KubernetesDeployment` base plus
  `local` and `prod` overlays. The `prod` overlay sets `STIGMER_MCP_TRANSPORT=http`,
  points `STIGMER_SERVER_ADDRESS` at the internal `stigmer-server` service, and
  exposes `mcp.stigmer.ai` via ingress with `/health` probes.
- **Service registration (stigmer-cloud):**
  `_ops/planton/service-hub/services/stigmer-mcp.yaml` — a Planton `Service` that
  builds `mcp-server/Dockerfile` via the platform pipeline into
  `ghcr.io/stigmer/stigmer/mcp-server` and deploys the kustomize overlay.

Register/update with `make apply-services` in `stigmer-cloud` (or
`planton apply -f stigmer-mcp.yaml`).

---

## Development

### Build and test

```bash
make build          # Build binary to bin/mcp-server-stigmer
make test           # Run tests with race detection
make lint           # Run golangci-lint (falls back to go vet)
make fmt            # Format all Go source files
make vet            # Run go vet (excludes gen/)
make tidy           # Run go mod tidy
```

### Code generation

MCP input types (the structs that define each tool's JSON Schema) are
**auto-generated** from protobuf definitions via a two-stage pipeline:

```bash
make codegen-schemas   # Stage 1: Proto → JSON schemas
make codegen-mcp       # Stage 2: JSON schemas → Go input types in gen/
make codegen           # Both stages
```

The `gen/` directory is entirely machine-generated. **Never edit files in `gen/`
by hand** — they will be overwritten on the next `make codegen` run.

> `go vet` excludes `gen/` because the `jsonschema-go` tag convention used in
> generated structs triggers false positives in the struct-tag checker.

### Domain package structure

Each resource domain (`agents`, `skills`, `workflows`, `mcpservers`) follows
the same file layout under `internal/domains/`:

| File | Purpose |
|------|---------|
| `tools.go` | MCP tool definitions and handlers |
| `resources.go` | MCP resource template and handler |
| `fetch.go` | Shared fetch logic (used by both tools and resources) |
| `apply.go` | Create-or-update logic |
| `delete.go` | Delete logic |

To add a new domain: create a package following this pattern, then register its
tools and resources in
[`internal/server/server.go`](internal/server/server.go).

### Docker

The Docker build must be invoked from the repository root:

```bash
cd <repo-root>
docker build -f mcp-server/Dockerfile -t ghcr.io/stigmer/mcp-server-stigmer:latest .
```

---

## License

Apache License 2.0. See [LICENSE](../LICENSE).
