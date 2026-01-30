# Design Decision: Use LangGraph's Built-in MCP Lifecycle Management

**Date**: 2026-01-27
**Status**: Accepted
**Decision Makers**: Suresh

---

## Context

We need to integrate MCP (Model Context Protocol) servers with the Stigmer agent runner. MCP servers can run via:
- **stdio**: Subprocess with stdin/stdout communication
- **HTTP (Streamable HTTP)**: HTTP requests to an already-running server
- **Docker**: Containerized server (not a standard MCP transport)

The original plan proposed building custom lifecycle managers for each transport type (~18-25 days of work).

## Research Findings

### MCP Protocol Spec

The MCP specification clearly states:
> "The client launches the MCP server as a subprocess" (for stdio transport)

This means the MCP **client** (not us) is responsible for subprocess lifecycle.

### LangGraph's MultiServerMCPClient

LangGraph's `langchain-mcp-adapters` package already provides:
- Subprocess spawning and termination (stdio)
- HTTP client sessions with connection pooling (HTTP)
- Graceful shutdown when session ends
- Multi-server management

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "transport": "stdio",
    }
})
```

### What the Original Plan Proposed

| Component | Purpose | Already in LangGraph? |
|-----------|---------|----------------------|
| `StdioServerManager` | Manage subprocess lifecycle | Yes |
| `HttpServerManager` | Manage HTTP sessions | Yes |
| `DockerServerManager` | Manage Docker containers | No (not standard MCP) |
| `McpServerRegistry` | Track running servers | Yes |
| `HealthMonitor` | Check server health | Partially |
| `ShutdownCoordinator` | Graceful shutdown | Yes |

## Decision

**Use LangGraph's built-in lifecycle management instead of building custom managers.**

Our responsibility:
1. Transform Stigmer's `McpServerSpec` proto to LangGraph's expected format
2. Resolve environment variable placeholders
3. Pass configuration to `MultiServerMCPClient`
4. Let LangGraph handle the rest

## Consequences

### Positive
- **15-20 days of development time saved**
- Less code to maintain
- Leverages battle-tested library
- Stays aligned with LangGraph ecosystem
- Easier to upgrade when LangGraph improves

### Negative
- Dependency on LangGraph's implementation details
- Less control over fine-grained lifecycle behavior
- If LangGraph has bugs, we inherit them

### Neutral
- Docker transport not supported (but can work around via HTTP)
- Custom health monitoring not implemented (can add later if needed)

## Alternatives Considered

### 1. Build Custom Lifecycle Managers (Rejected)
- 18-25 days of work
- Reimplements what LangGraph already does
- More code to maintain
- Risk of bugs in subprocess/process management

### 2. Fork LangGraph Adapters (Rejected)
- Maintenance burden
- Loses upstream improvements
- No clear benefit over using it directly

### 3. Use LangGraph + Custom Docker Support (Deferred)
- Could add Docker support later
- Users can work around by running containers manually + HTTP transport
- Not worth the complexity for initial release

## Implementation Notes

1. Add Node.js to agent-runner Dockerfile (required for npm-based MCP servers)
2. Create simple config transformer: Stigmer proto → LangGraph format
3. Mark Docker transport as "not currently supported" in proto docs
4. Environment variable resolution handled by existing infrastructure

---

*This decision reduces project scope from ~3 weeks to ~1 week while achieving the same functionality.*
