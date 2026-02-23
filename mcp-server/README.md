# Stigmer MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes Stigmer platform resources — agents, skills, MCP servers, and
workflows — to AI-powered development tools such as Cursor, Claude Desktop,
Windsurf, and VS Code.

### Use Cases

- **Resource Discovery**: Search, browse, and inspect agents, skills, workflows,
  and MCP servers across your Stigmer organization.
- **Agent Management**: Create, update, and manage agents and their
  configurations directly from your IDE.
- **Workflow Automation**: Define and apply workflows through natural language
  interactions with your AI assistant.
- **Skill Library**: Browse available skills, inspect versions, and attach them
  to agents.

---

## Installation

### Prerequisites

1. A running Stigmer server (local via `stigmer server` or Stigmer Cloud)
2. A compatible MCP host (Cursor, Claude Desktop, VS Code, Windsurf, etc.)

### Install with Go

If you have Go 1.25+ installed:

```bash
go install github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest
```

Then configure your MCP client to use the installed binary (see
[MCP Client Configuration](#mcp-client-configuration) below).

### Install with Docker

The Docker image is available at `ghcr.io/stigmer/mcp-server-stigmer`:

```bash
docker run -i --rm \
  -e STIGMER_SERVER_ADDRESS=api.stigmer.ai:443 \
  -e STIGMER_API_KEY=your-api-key \
  ghcr.io/stigmer/mcp-server-stigmer
```

### Via the Stigmer CLI

If you have the `stigmer` CLI installed, the MCP server is available as a
built-in command — no separate binary or Docker required:

```bash
stigmer mcp-server
```

The CLI auto-resolves connection settings from `~/.stigmer/config.yaml`, so
users who have already run `stigmer backend` get a zero-config experience.

### Build from Source

```bash
git clone https://github.com/stigmer/stigmer.git
cd stigmer/mcp-server
make build
./bin/mcp-server-stigmer
```

---

## MCP Client Configuration

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json` or global settings):

**Using Go install:**

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

**Using Docker:**

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

**Using the Stigmer CLI (zero-config with local backend):**

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

### Claude Desktop / Claude Code

Add to your Claude Desktop config (`claude_desktop_config.json`):

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

Or with Docker:

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

Add to `.vscode/mcp.json` in your workspace or to your user settings:

```json
{
  "servers": {
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

### Windsurf

Add to your Windsurf MCP configuration:

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

> **Note:** When using Docker, the `-e VAR_NAME` (without `=value`) syntax
> tells Docker to forward the variable from its own environment into the
> container. The MCP host sets the variables in `env`, the Docker CLI inherits
> them, and `-e` forwards them into the container. This is the same pattern
> used by the [GitHub MCP Server](https://github.com/github/github-mcp-server).

---

## Configuration

### Configuration Resolution (CLI)

When running via `stigmer mcp-server`, configuration is resolved with the
following precedence (highest wins):

```
CLI flags  >  environment variables  >  ~/.stigmer/config.yaml  >  defaults
```

The CLI automatically reads `~/.stigmer/config.yaml` and bridges the active
backend settings into the MCP server:

- **Local backend** (`backend.type: local`): server address is set to
  `localhost:7234` (the local daemon). No API key is needed.
- **Cloud backend** (`backend.type: cloud`): server address and API key are
  read from `backend.cloud.endpoint` and `backend.cloud.token`.

### Configuration Resolution (Standalone / Docker)

The standalone binary and Docker image read from environment variables only.
They do not read `~/.stigmer/config.yaml`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STIGMER_SERVER_ADDRESS` | `localhost:9090` | gRPC address of stigmer-server |
| `STIGMER_API_KEY` | *(optional)* | API key for authenticated backends. Auto-resolved from CLI config when running via `stigmer mcp-server`. Required for Stigmer Cloud. |
| `STIGMER_MCP_TRANSPORT` | `stdio` | Transport mode: `stdio`, `http`, or `both` |
| `STIGMER_MCP_HTTP_PORT` | `8080` | TCP port for the HTTP transport |
| `STIGMER_MCP_HTTP_AUTH_ENABLED` | `true` | Require Bearer token on HTTP requests |
| `STIGMER_MCP_LOG_FORMAT` | `text` | Log output encoding: `text` or `json` |
| `STIGMER_MCP_LOG_LEVEL` | `info` | Minimum log severity: `debug`, `info`, `warn`, or `error` |

---

## Tools

| Tool | Description |
|------|-------------|
| `search` | Unified search and list across agents, skills, MCP servers, and workflows. Supports full-text search, kind filtering, org scoping, and pagination. Each result includes a `resource_uri` that can be passed directly to `resources/read`. |
| `get_agent` | Retrieve the full definition of an agent by its org and slug. |
| `get_mcp_server` | Retrieve the full definition of an MCP server by its org and slug. |
| `get_skill` | Retrieve the full definition of a skill by org, slug, and optional version. |
| `get_workflow` | Retrieve the full definition of a workflow by its org and slug. |
| `apply_agent` | Create or update an agent definition. |
| `apply_mcp_server` | Create or update an MCP server definition. |
| `apply_workflow` | Create or update a workflow definition. |
| `delete_agent` | Delete an agent by its org and slug. |
| `delete_mcp_server` | Delete an MCP server by its org and slug. |
| `delete_skill` | Delete a skill by its org and slug. |
| `delete_workflow` | Delete a workflow by its org and slug. |

## Resources

The server exposes resource templates that MCP clients can use to read
Stigmer resources by URI, without calling a tool:

| URI Template | Description |
|--------------|-------------|
| `stigmer://agents/{org}/{slug}` | Full agent definition as JSON |
| `stigmer://mcp-servers/{org}/{slug}` | Full MCP server definition as JSON |
| `stigmer://skills/{org}/{slug}` | Full skill definition as JSON (latest version) |
| `stigmer://skills/{org}/{slug}/{version}` | Full skill definition as JSON at a specific version (tag name or SHA-256 hash) |
| `stigmer://workflows/{org}/{slug}` | Full workflow definition as JSON |

The `search` tool returns a `resource_uri` field in each result entry (for kinds
that have a resource template). Use `search` to discover resources, then pass
the `resource_uri` directly to `resources/read` — no manual URI construction
needed.

---

## HTTP Mode

For shared or remote deployments, run the server in HTTP mode:

```bash
export STIGMER_SERVER_ADDRESS="api.stigmer.ai:443"
export STIGMER_API_KEY="your-api-key"
export STIGMER_MCP_TRANSPORT="http"

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

Then configure your MCP client to connect to `http://host:8080` with an
`Authorization: Bearer <token>` header.

---

## Logging

All log output is written to **stderr** so that stdout remains available for
the STDIO transport protocol.

| Format | When to use |
|--------|-------------|
| `text` (default) | Local development — human-readable, one line per event |
| `json` | Production / log aggregation — machine-parseable, one JSON object per line |

In HTTP mode every request is logged with a unique `request_id`, the HTTP
method, path, response status code, and duration in milliseconds.

gRPC errors returned by stigmer-server are classified into user-friendly
messages for the MCP client. The original gRPC status code and message are
logged at WARN level for operator debugging.

## Graceful Shutdown

The server listens for `SIGINT` and `SIGTERM`. On receiving either signal:

- **HTTP mode** — in-flight requests are given a 5-second grace period to
  complete before the listener is forcefully closed.
- **STDIO mode** — the server stops when the MCP client disconnects or the
  signal is received.
- **Both mode** — both transports shut down concurrently; the process exits
  once both have drained.

---

## Docker

### Building the Image

```bash
docker build -f mcp-server/Dockerfile -t mcp-server-stigmer .
```

### Running

**STDIO mode** (for MCP clients like Cursor, Claude Desktop):

```bash
docker run -i --rm \
  -e STIGMER_SERVER_ADDRESS=localhost:7234 \
  -e STIGMER_API_KEY=your-api-key \
  ghcr.io/stigmer/mcp-server-stigmer
```

**HTTP mode** (for remote/shared deployments):

```bash
docker run --rm \
  -e STIGMER_SERVER_ADDRESS=api.stigmer.ai:443 \
  -e STIGMER_API_KEY=your-api-key \
  -e STIGMER_MCP_TRANSPORT=http \
  -p 8080:8080 \
  ghcr.io/stigmer/mcp-server-stigmer
```

---

## Architecture

```
cmd/mcp-server-stigmer/main.go   Standalone binary entry point
pkg/mcpserver/config.go          Public API: Config + DefaultConfig()
pkg/mcpserver/run.go             Public API: Run() — used by CLI and standalone binary
internal/config/config.go        Environment-based configuration
internal/auth/credentials.go     gRPC PerRPCCredentials + context-based API key helpers
internal/grpc/client.go          gRPC connection factory (TLS/insecure)
internal/server/server.go        MCP server initialization + tool registration
internal/server/http.go          Streamable HTTP handler with auth middleware
internal/domains/jsonutil.go     Shared protojson serialization
internal/domains/rpcerr.go       gRPC error classification → user-friendly messages
internal/domains/uriutil.go      Resource URI parsing and building
internal/domains/search/         search tool → SearchService.search
internal/domains/agents/         get_agent, apply_agent, delete_agent tools + resource template
internal/domains/mcpservers/     get_mcp_server, apply_mcp_server, delete_mcp_server tools + resource template
internal/domains/skills/         get_skill, delete_skill tools + resource template
internal/domains/workflows/      get_workflow, apply_workflow, delete_workflow tools + resource template
```

## License

This project is part of the [Stigmer](https://github.com/stigmer/stigmer)
platform and is available under the same license.
