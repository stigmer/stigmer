# Task T01: MCP Server Integration - Simplified Implementation Plan

**Created**: 2026-01-27
**Updated**: 2026-01-27 (Simplified after research)
**Status**: READY FOR IMPLEMENTATION
**Type**: Feature Development

---

## Executive Summary

Integrate MCP servers with the agent runner by leveraging **LangGraph's built-in lifecycle management** rather than building custom managers. LangGraph's `MultiServerMCPClient` already handles subprocess spawning, HTTP session management, and graceful shutdown.

**Key Insight**: The original plan (18-25 days) was overengineering. LangGraph already provides production-grade lifecycle management for MCP servers. Our job is to transform Stigmer's MCP server configuration into LangGraph's expected format.

**Revised Scope**: 3-5 days of focused integration work.

---

## Research Findings

### MCP Protocol Transport Types

| Transport | How It Works | Who Manages Lifecycle? |
|-----------|-------------|----------------------|
| **stdio** | Client spawns subprocess, communicates via stdin/stdout | LangGraph's `MultiServerMCPClient` |
| **HTTP (Streamable HTTP)** | Client makes HTTP requests to already-running server | No lifecycle needed - just HTTP calls |

### LangGraph's MultiServerMCPClient

LangGraph's `langchain-mcp-adapters` package provides:

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "transport": "stdio",
        "env": {"GITHUB_TOKEN": "..."}
    },
    "weather": {
        "url": "http://localhost:8000/mcp",
        "transport": "http",
        "headers": {"Authorization": "Bearer ..."}
    }
})

tools = await client.get_tools()
```

LangGraph handles:
- Subprocess spawning and termination (stdio)
- HTTP client sessions (HTTP)
- Connection pooling and session management
- Graceful shutdown when session ends

**We do NOT need to build custom lifecycle managers.**

### Agent Runner Docker Image Issue

Current agent-runner Dockerfile (`python:3.11-slim`) does NOT have:
- Node.js
- npm / npx

This means stdio MCP servers that require `npx` (most npm-based MCP servers) won't work.

**Solution**: Add Node.js to the agent-runner Dockerfile.

---

## What We Actually Need to Build

### 1. Configuration Transformer (1-2 days)

Transform Stigmer's `McpServerSpec` proto to LangGraph's expected format:

```python
# agent_runner/mcp/config_transformer.py

from typing import Dict, Any
from ai.stigmer.agentic.mcpserver.v1 import McpServerSpec

def transform_mcp_config(
    server_id: str,
    spec: McpServerSpec,
    resolved_env: Dict[str, str]
) -> Dict[str, Any]:
    """
    Transform Stigmer McpServerSpec to LangGraph MultiServerMCPClient format.
    
    Args:
        server_id: Unique identifier for this server
        spec: McpServerSpec from proto
        resolved_env: Environment variables with secrets already resolved
    
    Returns:
        Configuration dict for MultiServerMCPClient
    """
    if spec.HasField("stdio"):
        return {
            "command": spec.stdio.command,
            "args": list(spec.stdio.args),
            "transport": "stdio",
            "env": resolved_env,
            "cwd": spec.stdio.working_dir or None
        }
    
    elif spec.HasField("http"):
        # Resolve placeholders in headers (${VAR_NAME} -> actual value)
        resolved_headers = {
            k: _resolve_placeholders(v, resolved_env)
            for k, v in spec.http.headers.items()
        }
        resolved_params = {
            k: _resolve_placeholders(v, resolved_env)
            for k, v in spec.http.query_params.items()
        }
        
        # Build URL with query params
        url = spec.http.url
        if resolved_params:
            url = f"{url}?{'&'.join(f'{k}={v}' for k, v in resolved_params.items())}"
        
        return {
            "url": url,
            "transport": "http",
            "headers": resolved_headers,
        }
    
    else:
        raise ValueError("McpServerSpec must specify stdio or http")


def _resolve_placeholders(value: str, env: Dict[str, str]) -> str:
    """Resolve ${VAR_NAME} placeholders in a string."""
    import re
    
    def replace(match):
        var_name = match.group(1)
        return env.get(var_name, match.group(0))
    
    return re.sub(r'\$\{(\w+)\}', replace, value)
```

### 2. LangGraph Integration (1-2 days)

Integrate with agent execution to create MCP client:

```python
# agent_runner/mcp/client_factory.py

from langchain_mcp_adapters.client import MultiServerMCPClient
from typing import Dict, List
from .config_transformer import transform_mcp_config

async def create_mcp_client(
    mcp_servers: List[McpServerWithResolvedEnv]
) -> MultiServerMCPClient:
    """
    Create LangGraph MCP client from Stigmer MCP server configurations.
    
    Args:
        mcp_servers: List of MCP servers with resolved environment variables
    
    Returns:
        Configured MultiServerMCPClient ready for use
    """
    config = {}
    
    for server in mcp_servers:
        server_config = transform_mcp_config(
            server_id=server.id,
            spec=server.spec,
            resolved_env=server.resolved_env
        )
        config[server.id] = server_config
    
    return MultiServerMCPClient(config)
```

### 3. Update Agent Runner Dockerfile (1 day)

Add Node.js to support npm-based MCP servers:

```dockerfile
# In backend/services/agent-runner/Dockerfile

# ---------- Runtime Image ----------
FROM python:3.11-slim

# Install runtime dependencies including Node.js for MCP servers
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        curl && \
    # Add Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Verify Node.js installation
RUN node --version && npm --version
```


---

## Implementation Phases

### Phase 1: Configuration Transformer (1-2 days)
1. Create `config_transformer.py` with `transform_mcp_config()`
2. Implement placeholder resolution for HTTP headers/params
3. Add validation and error handling
4. Write unit tests for all transport types

### Phase 2: LangGraph Integration (1-2 days)
1. Create `client_factory.py` with `create_mcp_client()`
2. Integrate with agent execution flow
3. Ensure proper cleanup when agent execution ends
4. Write integration tests

### Phase 3: Dockerfile Update (0.5 days)
1. Add Node.js to agent-runner Dockerfile
2. Test npm-based MCP servers work (e.g., server-github)
3. Update documentation

**Total Duration**: 2.5-4.5 days

---

## What We're NOT Building

The original plan included these components that are **not needed**:

| Component | Why Not Needed |
|-----------|---------------|
| `StdioServerManager` | LangGraph handles subprocess lifecycle |
| `HttpServerManager` | LangGraph handles HTTP sessions |
| `DockerServerManager` | Docker transport not supported initially |
| `McpServerRegistry` | LangGraph manages server registry internally |
| `HealthMonitor` | LangGraph handles connection health |
| `ShutdownCoordinator` | LangGraph handles graceful shutdown |

**Estimated savings**: 15-20 days of development time.

---

## Success Criteria

- [ ] stdio MCP servers work (e.g., `npx @modelcontextprotocol/server-github`)
- [ ] HTTP MCP servers work (e.g., remote/managed MCP services)
- [ ] Environment variables resolved correctly
- [ ] Placeholder resolution works for HTTP headers (`${VAR_NAME}`)
- [ ] Agent runner Dockerfile includes Node.js
- [ ] Integration tests pass
- [ ] No custom lifecycle management code (use LangGraph)

---

## Files to Create/Modify

### New Files
- `backend/services/agent-runner/agent_runner/mcp/config_transformer.py`
- `backend/services/agent-runner/agent_runner/mcp/client_factory.py`
- `backend/services/agent-runner/tests/mcp/test_config_transformer.py`

### Modified Files
- `backend/services/agent-runner/Dockerfile` (add Node.js)
- `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` (Docker transport removed)

---

## Dependencies

- `langchain-mcp-adapters` - LangGraph's MCP adapter package
- Node.js 20.x - For npm-based MCP servers

---

## Notes

- Environment variable resolution is handled by a separate component (already implemented or in progress)
- Docker support can be added later if needed, but users can work around it by running containers manually and using HTTP transport
- The sandbox containers (basic/full) already have Node.js, so sandbox-based execution would work regardless

---

*This simplified plan focuses on integration rather than reimplementation.*
