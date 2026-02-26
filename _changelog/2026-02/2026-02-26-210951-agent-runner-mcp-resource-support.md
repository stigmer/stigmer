# Agent Runner MCP Resource Support

**Date**: February 26, 2026

## Summary

Added MCP resource discovery and reading capabilities to the Stigmer agent runner (graphton). Agents can now list available MCP resources and resource templates from connected servers and read their contents on demand, enabling schema-driven workflows like cloud resource provisioning.

## Problem Statement

The agent runner integrates with MCP servers for tool execution but has no awareness of MCP resources — read-only reference data that servers can expose. The upcoming mcp-server-planton redesign relies on resource templates (e.g., `cloud-resource-schema://{kind}`) to expose per-kind cloud resource schemas, which agents need to discover before calling `apply_cloud_resource`.

### Pain Points

- Agents cannot discover what reference data MCP servers provide
- No way for agents to read cloud resource schemas or other reference material at runtime
- `langchain-mcp-adapters` supports basic resources but has no resource template support
- Without resources, mcp-server-planton would need to embed 150+ schema variants into tool input schemas

## Solution

Pure tool-based approach (Option C from design review): expose two new LangChain tools (`list_mcp_resources` and `read_mcp_resource`) that agents invoke on demand. This mirrors how Cursor IDE and Claude Desktop surface MCP resources and avoids context bloat from eagerly injecting resource metadata.

## Implementation Details

### Core Resource Functions (`mcp_manager.py`)

- `list_mcp_resources(servers)` — Connects to each configured MCP server and queries both `list_resources()` (static) and `list_resource_templates()` (parameterized). Returns a unified dictionary keyed by server name with `resources` and `resource_templates` arrays. Handles connection failures gracefully per-server.
- `read_mcp_resource(servers, server_name, uri)` — Reads a specific resource by URI from a named server. Handles text content directly and base64-encodes binary content. Validates the server name before connecting.

Both functions access `ClientSession` via `MultiServerMCPClient.session()`, calling MCP SDK methods directly to get full protocol support including resource templates.

### LangChain Tool Factory (`resource_tools.py`)

- `create_resource_tools(servers)` — Returns two `@tool`-decorated async functions with server config captured in closures. Tool docstrings are written for LLM comprehension, explaining what resources and templates are and how to use them.

### Agent Wiring (`agent.py`)

- Resource tools are registered alongside MCP tool wrappers in `create_deep_agent()` when MCP servers are configured. No middleware changes needed since resources are read-only.

### Test Coverage

- 11 tests for `mcp_manager.py` covering: listing with/without resources, connection failures, partial server failures, reading text/binary content, invalid server names, multiple content items
- 10 tests for `resource_tools.py` covering: tool creation, descriptions, JSON output formatting, empty results, error propagation, text content extraction, multiple contents

## Benefits

- **Agent autonomy**: Agents can discover available schemas and reference data without hardcoding
- **Clean separation**: Resource access is opt-in via tool invocation, not forced context injection
- **Protocol alignment**: Supports both static resources and parameterized resource templates
- **Graceful degradation**: Servers that don't support resources are silently skipped
- **No breaking changes**: Existing tool-only flows are completely unaffected

## Impact

- **Agent runner (graphton)**: Now supports full MCP resource protocol alongside tools
- **mcp-server-planton**: Unblocked for implementing `cloud-resource-schema://{kind}` resource templates
- **Agent authors**: Can reference MCP resources in agent prompts and skill definitions
- **Future MCP servers**: Any new MCP server with resources will automatically work with the agent runner

## Related Work

- mcp-server-planton refactoring (Decisions #10-11): Resource templates for cloud schemas
- MCP server discovery (`_changelog/2026-02/2026-02-25-163052-mcp-server-discovery-proto-foundation.md`): Server capability reporting now includes `resource_templates`
- Agent runner generic MCP runtime (`_changelog/2026-02/2026-02-23-214943-agent-runner-generic-mcp-runtime.md`): Foundation this builds upon

---

**Status**: ✅ Production Ready
**Timeline**: Single session (investigation + implementation + testing)
