# Task T01: Add MCP Resources Support to Agent Runner

**Created**: 2026-02-26
**Status**: PENDING REVIEW
**Type**: Feature Development

## Executive Summary

The Stigmer agent runner currently only uses MCP tools from connected MCP servers.
It does not support MCP resources or resource templates. This project adds that
capability so agents can auto-discover typed schemas and reference data exposed
by MCP servers.

**Primary use case**: mcp-server-planton exposes per-kind cloud resource schemas
as MCP resource templates (e.g., `cloud-resource-schema://aws_alb`). Agents need
to read these schemas before calling `apply_cloud_resource` with the correct
provider-specific fields.

---

## Current State Analysis

### What exists today

1. **MCP client**: `langchain_mcp_adapters.MultiServerMCPClient` (v0.1.14)
2. **Tool loading**: `mcp_client.get_tools()` discovers tools from all connected servers
3. **Tool execution**: `AuthenticatedMcpToolNode` calls tools with per-request auth
4. **No resource support**: No code calls `list_resources()`, `read_resource()`,
   or handles resource templates anywhere in the agent runner

### Key files

- `backend/services/agent-runner/worker/activities/execute_graphton.py` — MCP client init
- `backend/services/agent-runner/worker/mcp/config_transformer.py` — Server config transform
- `backend/libs/python/graphton/src/graphton/core/mcp_manager.py` — MCP lifecycle management
- `backend/libs/python/graphton/src/graphton/core/authenticated_tool_node.py` — Tool execution

---

## What MCP Resources Are (for context)

MCP resources are read-only data exposed by MCP servers. Unlike tools (which perform
actions), resources provide reference data that agents can read.

- **Resources**: Static data with a fixed URI (e.g., `config://database-schema`)
- **Resource Templates**: Parameterized URIs (e.g., `cloud-resource-schema://{kind}`)
  that the client fills in to read specific resources

The MCP protocol defines these operations:
- `resources/list` — List available resources and resource templates
- `resources/read` — Read a specific resource by URI
- `resources/templates/list` — List available resource templates

---

## Phase Breakdown

### Phase 1: Investigation

1. **Check `langchain-mcp-adapters` resource support**
   - Does `MultiServerMCPClient` expose `list_resources()` or `read_resource()`?
   - If not, does the underlying MCP client session support it?
   - Check the latest version of the library for resource APIs

2. **Check the official MCP Python SDK (`mcp` package)**
   - The `ClientSession` class should have `list_resources()` and `read_resource()`
   - Determine if we can use these directly alongside `langchain-mcp-adapters`

3. **Design decision**: Use `langchain-mcp-adapters` native support (if it exists)
   OR build a thin wrapper around the MCP SDK's `ClientSession` for resources

### Phase 2: Implementation

1. **Resource reading capability** in `graphton`
   - Add `list_resources()` and `read_resource(uri)` methods to the MCP manager
   - Handle resource templates (parameterized URIs)
   - Support per-request auth (same pattern as tool calls)

2. **Agent resource discovery**
   - During agent init, list available resources from all connected MCP servers
   - Make resource list available to the agent's tool/resource selection logic
   - Allow agents to read resources during execution (not just at startup)

3. **Integration with LangGraph**
   - Resources are NOT tools — they don't need to be registered as LangChain tools
   - But agents need a way to access them (either as a built-in capability or
     via a meta-tool like "read_mcp_resource")
   - Design decision: Should resource reading be a built-in agent capability
     or exposed as a LangChain tool?

### Phase 3: Testing

1. Test with an MCP server that exposes resources (e.g., local test server)
2. Verify per-request auth works for resource reads
3. Verify resource templates with parameters work
4. Test with mcp-server-planton's cloud resource schema templates (once available)

---

## Open Questions (need investigation)

1. Does `langchain-mcp-adapters` v0.1.14+ support MCP resources?
2. Should resource reads be a built-in agent capability or a LangChain tool?
3. Should resources be fetched eagerly (at agent startup) or lazily (on demand)?
4. How to handle resource pagination for servers with many resources?
5. Should the `McpServerUsage` proto be extended to configure resource filtering
   (similar to `enabled_tools`)?

---

## Success Criteria

- Agent runner can list MCP resources from connected servers
- Agent runner can read specific resources by URI
- Resource templates with parameters are supported
- Per-request auth works for resource reads (same as tool calls)
- Agents can auto-discover and use resources during execution

## Related Work

- **mcp-server-planton refactoring**: `mcp-server-planton/_projects/2026-02/20260226.01.refactor-mcp-server-stigmer-patterns/`
  Decision #10-11 depend on this project.

---

## Review Process

**What happens next**:
1. **You review this plan** — especially the open questions and phase breakdown
2. **Provide feedback** — any concerns, changes to scope, answers to open questions
3. **I'll revise the plan** — incorporate your feedback
4. **You approve** — give explicit approval to proceed
5. **Execution begins** — tracked in T01_3_execution.md

**Please consider**:
- Does the phase breakdown make sense?
- Should resource reading be a tool or a built-in capability?
- Any concerns about the `langchain-mcp-adapters` approach?
- Priority relative to other work?
