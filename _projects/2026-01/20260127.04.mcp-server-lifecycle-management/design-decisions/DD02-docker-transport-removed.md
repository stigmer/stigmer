# Design Decision: Docker Transport Removed from Proto

**Date**: 2026-01-27
**Status**: Accepted
**Decision Makers**: Suresh

---

## Context

The MCP Server spec initially included three transport types:
1. **stdio** - Subprocess with stdin/stdout (standard MCP transport)
2. **HTTP** - HTTP requests (standard MCP transport)
3. **Docker** - Containerized server (NOT a standard MCP transport)

## Decision

**Remove Docker transport entirely from the proto spec.**

We can add it back later when there's a clear need.

## Rationale

### Why Remove Instead of Marking Unsupported?

- **YAGNI (You Aren't Gonna Need It)**: No current use case for Docker transport
- **Simpler API**: Fewer options = less confusion
- **Not Standard MCP**: Docker is not defined in the MCP protocol spec
- **Can Add Later**: Proto evolution allows adding new oneofs without breaking existing clients

### Why Not Implement It?

- **Complexity**: Docker SDK, image pulling, container lifecycle, volumes, ports, health checks
- **Limited Value**: Users can achieve the same result by running containers manually + HTTP transport
- **LangGraph Doesn't Support It**: LangGraph's `MultiServerMCPClient` only supports stdio and HTTP

### Workaround for Users

If a user wants to run an MCP server in Docker:

```bash
# 1. Run container manually
docker run -d -p 8000:8000 -e API_KEY=xxx my-mcp-server:latest

# 2. Configure as HTTP in Stigmer
mcp_server:
  name: my-docker-mcp
  spec:
    http:
      url: "http://localhost:8000/mcp"
      headers:
        Authorization: "Bearer ${API_KEY}"
```

This gives users **more control** over:
- Docker runtime selection
- Network configuration
- Volume mounts
- Resource limits
- Container restart policies

## Proto Changes

### Removed
- `DockerServerConfig docker = 6;` from `server_type` oneof
- `DockerServerConfig` message
- `VolumeMount` message  
- `PortMapping` message

### Result
Clean proto with only stdio and HTTP transports:

```protobuf
oneof server_type {
  option (buf.validate.oneof).required = true;
  StdioServerConfig stdio = 4;
  HttpServerConfig http = 5;
}
```

## Future Considerations

If Docker support becomes necessary:
1. Research actual user demand (do people really need it?)
2. Check if LangGraph added Docker support
3. Design for security (container isolation, registry auth, resource limits)
4. Consider sandbox container infrastructure integration

For now: **keep it simple, add when needed.**

---

*Simplicity over premature features.*
