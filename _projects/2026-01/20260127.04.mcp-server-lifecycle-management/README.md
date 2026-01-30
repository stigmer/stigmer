# Project: 20260127.04.mcp-server-lifecycle-management

## Overview
Integrate MCP servers with agent runner using LangGraph's built-in lifecycle management

**Created**: 2026-01-27
**Updated**: 2026-01-30 (Implementation & Tests Complete)
**Status**: Complete ✅ - Ready for Manual Testing

## Key Insight

**LangGraph already handles MCP server lifecycle management.**

Original plan proposed building custom subprocess managers, HTTP session managers, and Docker container managers (~18-25 days). After research, we discovered that LangGraph's `MultiServerMCPClient` already provides production-grade lifecycle management.

**Revised scope**: 3-5 days of integration work.

## What We Built

| Component | Status | Description |
|-----------|--------|-------------|
| Config Transformer | ✅ Complete | Transform Stigmer `McpServerSpec` to LangGraph format |
| MCP Server gRPC Client | ✅ Complete | Fetch MCP server configs with parallel loading |
| LangGraph Integration | ✅ Complete | Pass MCP configs to `create_deep_agent()` |
| Dockerfile Update | ✅ Complete | Added Node.js 20.x for npm-based MCP servers |
| Unit Tests | ✅ Complete | 40 tests across 3 test files |

## What We're NOT Building

| Component | Why Not |
|-----------|---------|
| `StdioServerManager` | LangGraph handles subprocess lifecycle |
| `HttpServerManager` | LangGraph handles HTTP sessions |
| `DockerServerManager` | Docker transport not supported initially |
| `HealthMonitor` | LangGraph handles connection health |
| `ShutdownCoordinator` | LangGraph handles graceful shutdown |

## Design Decisions

See [design-decisions/](design-decisions/) for detailed rationale:
- **DD01**: Use LangGraph's built-in lifecycle management
- **DD02**: Docker transport removed from proto (can add later if needed)

## Project Information

### Primary Goal
Transform Stigmer MCP server configuration to LangGraph format and leverage `MultiServerMCPClient` for stdio/HTTP transport

### Timeline
**Target Completion**: 3-5 days (reduced from 2-3 weeks)

### Technology Stack
- Python (agent runner)
- langchain-mcp-adapters
- Node.js (for npm-based MCP servers like `npx @modelcontextprotocol/server-github`)

### Project Type
Feature Development (Simplified Integration)

### Affected Components
- stigmer/backend/services/agent-runner (Dockerfile, MCP integration)
- stigmer/apis (proto documentation updates)

## Supported Transports

| Transport | Supported | Notes |
|-----------|-----------|-------|
| stdio | ✅ Yes | LangGraph spawns subprocess |
| HTTP | ✅ Yes | LangGraph makes HTTP requests |

## Dependencies

- MCP Server API Resource project (proto spec complete)
- Environment Variables project (env resolution - separate project)
- Node.js in agent-runner Docker image (to be added)

## Success Criteria

### Implementation ✅
- [x] Config transformation correct (Stigmer proto → LangGraph format)
- [x] Placeholder resolution works (`${VAR_NAME}` in HTTP headers)
- [x] Agent runner Dockerfile includes Node.js 20.x
- [x] MCP server gRPC client with parallel fetching
- [x] Integration with execute_graphton (Step 5)
- [x] Comprehensive unit tests (40 tests)

### Manual Testing 📋 (User will perform)
- [ ] stdio MCP servers work (e.g., `npx @modelcontextprotocol/server-github`)
- [ ] HTTP MCP servers work (e.g., remote/managed MCP services)
- [ ] Tool filtering works in production
- [ ] Environment variable resolution works end-to-end

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

## Current Status

### Active Task
See [tasks/T01_0_plan.md](tasks/T01_0_plan.md) - Simplified implementation plan

### Progress Tracking
- [x] Project initialized (2026-01-27)
- [x] Research complete (LangGraph handles lifecycle)
- [x] Design decisions documented (DD01, DD02)
- [x] Config transformer implementation (2026-01-30 AM)
- [x] MCP server gRPC client (2026-01-30 AM)
- [x] LangGraph integration (2026-01-30 AM)
- [x] Dockerfile update (Node.js 20.x added)
- [x] Unit testing complete (40 tests, 2026-01-30 PM)
- [x] Implementation complete ✅
- [ ] Manual testing (user will perform)
- [ ] Project finalized

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/T01_0_plan.md)
- [Design Decisions](design-decisions/)
- [Latest Checkpoint](checkpoints/)

## Notes

### Agent Runner Docker Image Issue

The current agent-runner Dockerfile (`python:3.11-slim`) does NOT have Node.js/npm/npx.
Most MCP servers are npm packages that require npx to run (e.g., `npx @modelcontextprotocol/server-github`).

**Solution**: Add Node.js 20.x to the agent-runner Dockerfile.

### Docker Transport

Removed from proto spec to keep it simple. Users who need containerized MCP servers can:
1. Run the container themselves: `docker run -d -p 8000:8000 my-mcp-server`
2. Configure HTTP transport: `url: "http://localhost:8000/mcp"`

This gives users more control over container configuration (volumes, networks, resource limits).
Can be added back to the proto if there's demand.

---

## Implementation Summary

### What Was Delivered

#### 1. Configuration Transformer
**File**: `backend/services/agent-runner/worker/mcp/config_transformer.py`

Transforms Stigmer's proto-based MCP server configuration to LangGraph's expected format:

```python
# For stdio transport (subprocess-based MCP servers)
{
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {"GITHUB_TOKEN": "ghp_xxx"},
    "cwd": "/optional/working/dir"
}

# For HTTP transport (already-running MCP servers)
{
    "transport": "streamable_http",
    "url": "https://mcp.example.com/v1?region=us-west",
    "headers": {"Authorization": "Bearer token123"},
    "timeout": 60
}
```

**Key Features**:
- **Placeholder Resolution**: `${VAR_NAME}` → resolved from environment variables
- **Tool Filtering**: Respects `enabled_tools` from `McpServerUsage`
- **Multi-server Support**: Transforms multiple MCP servers in parallel

#### 2. MCP Server gRPC Client
**File**: `backend/services/agent-runner/grpc_client/mcp_server_client.py`

Fetches MCP server configurations from the Stigmer API:

```python
client = McpServerClient(api_key=env["STIGMER_API_KEY"])

# Fetch multiple servers in parallel
servers = await client.list_by_refs([
    agent.spec.mcp_server_usages[0].mcp_server_ref,
    agent.spec.mcp_server_usages[1].mcp_server_ref,
])
```

**Features**:
- Parallel fetching with `asyncio.gather`
- Error handling (NOT_FOUND, connection errors)
- Follows existing `SkillClient` pattern

#### 3. Execute Graphton Integration
**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

Added **Step 5** to the agent execution flow:

```
Step 1: Fetch agent metadata
Step 2: Fetch skills
Step 3: Fetch environment variables
Step 4: Merge environments → merged_env_vars
Step 5: Fetch & transform MCP servers → mcp_servers_config, mcp_tools_config
Step 6: Create Graphton agent (receives MCP configs)
Step 7: Execute agent graph
```

**Graceful Degradation**: If MCP server fetch fails, agent continues without MCP tools.

#### 4. Dockerfile Update
**File**: `backend/services/agent-runner/Dockerfile`

Added Node.js 20.x to support npm-based MCP servers:

```dockerfile
# Install Node.js from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Verify installation
RUN node --version && npm --version && npx --version
```

**Why**: Most MCP servers are npm packages run via `npx`:
- `npx @modelcontextprotocol/server-github`
- `npx @modelcontextprotocol/server-filesystem`
- Custom npm-published MCP servers

#### 5. Comprehensive Test Suite
**Test Coverage**: 40 tests across 3 files

- **`test_mcp_server_client.py`** (17 tests): gRPC client methods, parallel fetching, error handling
- **`test_mcp_manager.py`** (9 tests): Tool loading, filtering, validation
- **`test_middleware.py`** (14 tests): Middleware lifecycle, deferred loading, tool caching

All tests follow existing codebase patterns and pass linter checks.

---

## Usage Examples

### Example 1: GitHub MCP Server (stdio)

Configure an agent to use the GitHub MCP server for code search and analysis:

**1. Create MCP Server Resource** (via API):
```json
{
  "metadata": {
    "org_id": "org_xxx",
    "display_name": "GitHub Code Server",
    "slug": "github-code-server"
  },
  "spec": {
    "stdio": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    },
    "default_enabled_tools": ["search_code", "read_file", "list_repos"]
  }
}
```

**2. Add Environment Variable** (for GitHub token):
- Name: `GITHUB_TOKEN`
- Value: `ghp_your_token_here`
- Scope: Agent-specific

**3. Configure Agent**:
```protobuf
message AgentSpec {
  repeated McpServerUsage mcp_server_usages = 10;
}

message McpServerUsage {
  ApiResourceReference mcp_server_ref = 1;  // -> github-code-server
  repeated string enabled_tools = 2;  // ["search_code", "read_file"]
}
```

**4. Execution**: When agent runs, it will have access to GitHub MCP tools!

---

### Example 2: Custom HTTP MCP Server

Use a custom API that implements the MCP protocol over HTTP:

**1. Create MCP Server Resource**:
```json
{
  "metadata": {
    "slug": "weather-api-mcp"
  },
  "spec": {
    "http": {
      "url": "https://mcp.weather.com/v1",
      "headers": {
        "Authorization": "Bearer ${WEATHER_API_KEY}",
        "X-Region": "${AWS_REGION}"
      },
      "query_params": {
        "version": "2024-01"
      },
      "timeout_seconds": 30
    },
    "default_enabled_tools": ["get_weather", "get_forecast"]
  }
}
```

**2. Add Environment Variables**:
- `WEATHER_API_KEY`: Your API key
- `AWS_REGION`: `us-west-2`

**3. At Runtime**:
- Placeholders resolved: `${WEATHER_API_KEY}` → actual key
- Final URL: `https://mcp.weather.com/v1?version=2024-01`
- Headers: `Authorization: Bearer actual_key_value`

---

### Example 3: Multiple MCP Servers

Combine multiple MCP servers in one agent:

```protobuf
message AgentSpec {
  repeated McpServerUsage mcp_server_usages = 10 [
    {
      mcp_server_ref: {slug: "github-code-server"},
      enabled_tools: ["search_code"]
    },
    {
      mcp_server_ref: {slug: "filesystem-server"},
      enabled_tools: ["read_file", "write_file"]
    },
    {
      mcp_server_ref: {slug: "weather-api-mcp"},
      enabled_tools: ["get_weather"]
    }
  ];
}
```

All three MCP servers will be initialized and their tools made available to the agent.

---

## Architecture Overview

```
Agent.mcp_server_usages (references)
    ↓
McpServerClient.list_by_refs() (gRPC, parallel fetch)
    ↓
[McpServer, McpServer, ...] (proto specs)
    ↓
transform_all_mcp_configs(servers, usages, env_vars)
    ↓
{mcp_servers: {...}, mcp_tools: {...}} (LangGraph format)
    ↓
create_deep_agent(mcp_servers=..., mcp_tools=...)
    ↓
Graphton initializes MultiServerMCPClient
    ↓
LangGraph manages MCP server lifecycle
```

---

## Files Changed

### Created (11 files)
```
backend/services/agent-runner/
├── worker/mcp/
│   ├── __init__.py
│   └── config_transformer.py
├── grpc_client/
│   └── mcp_server_client.py
└── tests/
    ├── mcp/
    │   ├── __init__.py
    │   └── test_config_transformer.py
    └── test_mcp_server_client.py

backend/libs/python/graphton/
└── tests/
    ├── __init__.py
    ├── conftest.py
    └── core/
        ├── __init__.py
        ├── test_mcp_manager.py
        └── test_middleware.py
```

### Modified (2 files)
```
backend/services/agent-runner/
├── Dockerfile (+10 lines: Node.js 20.x)
└── worker/activities/execute_graphton.py (+60 lines: Step 5)
```

**Total**: ~1900 lines of production code and tests

---

## Performance Notes

### Actual vs Estimated Timeline

| Phase | Estimated | Actual | Notes |
|-------|-----------|--------|-------|
| Research | 1 day | 1 session | Discovered LangGraph handles lifecycle |
| Implementation | 2.5-4.5 days | 2 hours | Architecture planning paid off |
| Testing | 1 day | 1.5 hours | Followed existing patterns |
| **Total** | **4.5-6.5 days** | **2 sessions** | **~10x faster** |

### Why So Fast?
1. LangGraph already handles complex lifecycle management
2. Clear architecture design in planning phase
3. Following existing code patterns (SkillClient, fixtures)
4. No architectural decisions needed during implementation

---

## Manual Testing Checklist

When ready to test:

1. **Prepare Test Environment**
   - [ ] Create test MCP server resource (GitHub server recommended)
   - [ ] Add required environment variables (e.g., `GITHUB_TOKEN`)
   - [ ] Create test agent with `mcp_server_usages`

2. **Test stdio Transport**
   - [ ] Execute agent with npm-based MCP server
   - [ ] Verify tools are loaded
   - [ ] Verify tools can be invoked
   - [ ] Check logs for errors

3. **Test HTTP Transport**
   - [ ] Create HTTP MCP server (or mock)
   - [ ] Configure agent to use HTTP server
   - [ ] Execute and verify tools work
   - [ ] Test placeholder resolution in headers

4. **Test Tool Filtering**
   - [ ] Configure `enabled_tools` in usage
   - [ ] Verify only specified tools are loaded
   - [ ] Test with empty enabled_tools (should use defaults)

5. **Test Error Handling**
   - [ ] Try with invalid MCP server reference
   - [ ] Try with missing environment variables
   - [ ] Verify agent continues (graceful degradation)

---

## Known Limitations

1. **Docker transport not supported** - Users must run containers manually and use HTTP
2. **No health checks** - If MCP server crashes, agent won't detect it
3. **No retry logic** - Transient failures won't auto-retry
4. **Placeholder warnings only** - Unresolved placeholders log warnings but don't fail

These are acceptable for MVP and can be enhanced in future iterations.

---

## Future Enhancements

If needed later:
- MCP server health monitoring
- Retry logic for transient failures  
- Metrics collection (fetch times, tool invocation counts)
- Docker transport support
- Integration tests with mock MCP servers
- MCP server configuration examples repository
