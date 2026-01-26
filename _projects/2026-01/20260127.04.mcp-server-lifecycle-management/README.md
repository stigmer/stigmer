# Project: 20260127.04.mcp-server-lifecycle-management

## Overview
Integrate MCP servers with agent runner using LangGraph's built-in lifecycle management

**Created**: 2026-01-27
**Updated**: 2026-01-27 (Simplified after research)
**Status**: Active 🟢

## Key Insight

**LangGraph already handles MCP server lifecycle management.**

Original plan proposed building custom subprocess managers, HTTP session managers, and Docker container managers (~18-25 days). After research, we discovered that LangGraph's `MultiServerMCPClient` already provides production-grade lifecycle management.

**Revised scope**: 3-5 days of integration work.

## What We're Building

| Component | Description |
|-----------|-------------|
| Config Transformer | Transform Stigmer `McpServerSpec` to LangGraph format |
| LangGraph Integration | Create `MultiServerMCPClient` from agent config |
| Dockerfile Update | Add Node.js for npm-based MCP servers |

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

- [ ] stdio MCP servers work (e.g., `npx @modelcontextprotocol/server-github`)
- [ ] HTTP MCP servers work (e.g., remote/managed MCP services)
- [ ] Config transformation correct (Stigmer proto → LangGraph format)
- [ ] Placeholder resolution works (`${VAR_NAME}` in HTTP headers)
- [ ] Agent runner Dockerfile includes Node.js

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
- [x] Project initialized
- [x] Research complete (LangGraph handles lifecycle)
- [x] Design decisions documented
- [ ] Config transformer implementation
- [ ] LangGraph integration
- [ ] Dockerfile update
- [ ] Proto documentation update
- [ ] Testing and validation
- [ ] Project completed

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
