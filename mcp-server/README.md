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

## Quick Start

### Cursor / Claude Desktop (STDIO)

Add the server to your MCP client configuration:

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

./mcp-server-stigmer
```

Then configure your MCP client to connect to `http://host:8080` with a
`Authorization: Bearer <token>` header.

## Configuration

All settings are read from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `STIGMER_SERVER_ADDRESS` | `localhost:9090` | gRPC address of stigmer-server |
| `STIGMER_API_KEY` | *(required for stdio/both)* | API key for authenticating with stigmer-server |
| `STIGMER_MCP_TRANSPORT` | `stdio` | Transport mode: `stdio`, `http`, or `both` |
| `STIGMER_MCP_HTTP_PORT` | `8080` | TCP port for the HTTP transport |
| `STIGMER_MCP_HTTP_AUTH_ENABLED` | `true` | Require Bearer token on HTTP requests |

## Build

```bash
# From the mcp-server/ directory
make build

# From the repository root
cd mcp-server && make build
```

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
cmd/mcp-server-stigmer/main.go   Entry point: config loading, transport switch
internal/config/config.go        Environment-based configuration
internal/auth/credentials.go     gRPC PerRPCCredentials + context-based API key helpers
internal/grpc/client.go          gRPC connection factory (TLS/insecure)
internal/server/server.go        MCP server initialization + tool registration
internal/server/http.go          Streamable HTTP handler with auth middleware
internal/domains/jsonutil.go     Shared protojson serialization
internal/domains/search/         search tool → SearchService.search
internal/domains/agents/         get_agent tool → AgentQueryController.getByReference
internal/domains/skills/         get_skill tool → SkillQueryController.getByReference
internal/domains/workflows/      get_workflow tool → WorkflowQueryController.getByReference
```
