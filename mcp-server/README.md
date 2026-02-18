# mcp-server-stigmer

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes Stigmer platform resources — agents, skills, and workflows — to
AI-powered development tools such as Cursor, Claude Desktop, and Windsurf.

## Tools

| Tool | Description |
|------|-------------|
| `search` | Unified search and list across agents, skills, MCP servers, and workflows. Supports full-text search, kind filtering, org scoping, and pagination. |
| `get_agent` | Retrieve the full definition of an agent by its org and slug. |
| `get_skill` | Retrieve the full definition of a skill by org, slug, and optional version. |
| `get_workflow` | Retrieve the full definition of a workflow by its org and slug. |

## Resources

The server also exposes resource templates that MCP clients can use to read
Stigmer resources by URI, without calling a tool:

| URI Template | Description |
|--------------|-------------|
| `stigmer://agents/{org}/{slug}` | Full agent definition as JSON |
| `stigmer://skills/{org}/{slug}` | Full skill definition as JSON (latest version) |
| `stigmer://workflows/{org}/{slug}` | Full workflow definition as JSON |

Use the `search` tool to discover available resources, then read them by URI.

## Quick Start

### Running via the Stigmer CLI

If you have the `stigmer` CLI installed, the MCP server is available as a
built-in command — no separate binary required:

```bash
# STDIO mode (default)
stigmer mcp-server

# HTTP mode on a custom port
stigmer mcp-server --transport http --port 9090
```

CLI flags override environment variables. Run `stigmer mcp-server --help` for
the full list.

### Cursor / Claude Desktop (STDIO)

Add the server to your MCP client configuration. When using the CLI, it
auto-resolves connection settings from `~/.stigmer/config.yaml`:

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

If you need to override the auto-resolved settings, or use the standalone
binary, specify environment variables explicitly:

```json
{
  "mcpServers": {
    "stigmer": {
      "command": "/path/to/mcp-server-stigmer",
      "env": {
        "STIGMER_SERVER_ADDRESS": "api.stigmer.ai:443",
        "STIGMER_API_KEY": "your-api-key"
      }
    }
  }
}
```

### HTTP Mode (Remote / Shared)

```bash
export STIGMER_SERVER_ADDRESS="api.stigmer.ai:443"
export STIGMER_API_KEY="your-api-key"   # not required in HTTP mode
export STIGMER_MCP_TRANSPORT="http"
export STIGMER_MCP_HTTP_PORT="8080"

# Via the CLI
stigmer mcp-server --transport http

# Or via the standalone binary
./mcp-server-stigmer
```

Then configure your MCP client to connect to `http://host:8080` with a
`Authorization: Bearer <token>` header.

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

This means users who have already run `stigmer backend` get a zero-config
MCP server experience — just run `stigmer mcp-server`.

### Configuration Resolution (Standalone Binary)

The standalone `mcp-server-stigmer` binary reads from environment variables
only. It does not read `~/.stigmer/config.yaml`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STIGMER_SERVER_ADDRESS` | `localhost:9090` | gRPC address of stigmer-server |
| `STIGMER_API_KEY` | *(optional)* | API key for authenticated backends (auto-resolved from CLI config when running via `stigmer mcp-server`) |
| `STIGMER_MCP_TRANSPORT` | `stdio` | Transport mode: `stdio`, `http`, or `both` |
| `STIGMER_MCP_HTTP_PORT` | `8080` | TCP port for the HTTP transport |
| `STIGMER_MCP_HTTP_AUTH_ENABLED` | `true` | Require Bearer token on HTTP requests |
| `STIGMER_MCP_LOG_FORMAT` | `text` | Log output encoding: `text` or `json` |
| `STIGMER_MCP_LOG_LEVEL` | `info` | Minimum log severity: `debug`, `info`, `warn`, or `error` |

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

## Build

```bash
# From the mcp-server/ directory
make build

# From the repository root
cd mcp-server && make build
```

`make build` injects the version from `git describe --tags --always --dirty`
into the binary via `-ldflags`. The MCP server reports this version to clients
during the `initialize` handshake. Binaries built without ldflags report
`"dev"`.

## Docker

The Dockerfile must be built from the repository root (the build context needs
access to `apis/stubs/go/` for the Go module replace directive):

```bash
# From the repository root
docker build -f mcp-server/Dockerfile -t mcp-server-stigmer .

# Run
docker run \
  -e STIGMER_SERVER_ADDRESS=api.stigmer.ai:443 \
  -e STIGMER_MCP_TRANSPORT=http \
  -p 8080:8080 \
  mcp-server-stigmer
```

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
internal/domains/uriutil.go      Resource URI parsing (stigmer://{kind}/{org}/{slug})
internal/domains/search/         search tool → SearchService.search
internal/domains/agents/         get_agent tool + agent resource template
internal/domains/skills/         get_skill tool + skill resource template
internal/domains/workflows/      get_workflow tool + workflow resource template
```
