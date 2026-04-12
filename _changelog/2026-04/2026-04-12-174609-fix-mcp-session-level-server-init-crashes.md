# Fix MCP Server Initialization Crashes for Session-Level Servers

**Date**: April 12, 2026

## Summary

Fixed three bugs that caused agent execution to crash when MCP servers were added at the session level rather than declared on the agent. The root causes were identified through production MongoDB queries: an empty tool list validation mismatch, missing OAuth token injection for session-scoped servers, and an org mismatch in the frontend grant status lookup.

## Problem Statement

When a user added `mcp-server-linear` to a session via the UI (not pre-configured on the agent), the agent execution failed immediately at initialization with:

```
Server 'mcp-server-linear' has empty tool list. Specify at least one tool to load or remove the server entry.
```

Additionally, even if the agent could start, the `LINEAR_ACCESS_TOKEN` was never injected despite the user having a valid OAuth grant with an unexpired token.

### Pain Points

- Agent executions crashed before starting — no tools available, no error recovery
- OAuth tokens for session-level MCP servers were silently dropped
- The MCP server detail page showed "Not connected" even after successful OAuth sign-in
- All three issues only manifested with **public/shared** MCP servers added at the session level, not agent-level servers

## Solution

Three targeted fixes across the Python agent-runner, Go/Java server backends, and React SDK:

1. **Empty tool list expansion** — resolve the "all tools" convention (`[]`) to explicit tool names from `server.status.discovered_capabilities.tools` before reaching Graphton validation
2. **Session-level OAuth injection** — merge agent + session MCP usages before iterating for OAuth token and env var injection
3. **Frontend org mismatch** — use the user's active org (not the server's owner org) for OAuth grant status lookups

## Implementation Details

### Bug 1: Tool list validation crash (config_transformer.py, setup.py)

`transform_mcp_config` returns `tools = []` when neither `enabled_tools` nor `default_enabled_tools` is set — the proto convention for "all tools." But `AgentConfig.validate_mcp_tools_structure` rejects empty lists. The `server.status.discovered_capabilities.tools` (31 tool names for Linear) was available in `transform_all_mcp_configs` but never read.

Added `_get_discovered_tool_names(server)` helper and expansion logic in `transform_all_mcp_configs`. Servers with no discovered tools are skipped with a warning. Belt-and-suspenders filter added in `setup.py`.

### Bug 2: OAuth token not injected (Go + Java)

`injectMcpOAuthFromManagedEnvironment` only iterated `agentResource.GetSpec().GetMcpServerUsages()`. The "assistant" agent had no MCP usages — Linear was only on the session. The function returned early without ever looking up the OAuth grant.

Added `mergeAgentAndSessionMcpUsages()` in both Go and Java that deduplicates by slug (agent takes priority). Updated `injectMcpOAuthFromManagedEnvironment`, `injectMcpEnvFromPersonalEnvironment`, and `McpEnvironmentValidator` to use the merged list. Added `List<McpServerUsage>` overloads to `McpEnvironmentValidator`.

### Bug 3: Frontend "Not connected" badge (McpServerDetailView.tsx)

OAuth sign-in stored the grant with `orgId = suresh-kkp` (user's active org via `activeOrg ?? org`), but the grant status lookup passed `org = stigmer` (the MCP server's owner org). One-line fix: `useMcpServerCredentials(activeOrg ?? org, ...)`.

## Benefits

- Agent executions with session-level MCP servers no longer crash at initialization
- OAuth tokens are correctly injected regardless of whether the server was added at agent or session level
- The MCP server detail page correctly reflects the user's connection status for public servers
- Graceful degradation: servers with no discoverable tools are skipped with a warning rather than crashing

## Impact

- **Users**: Can now use MCP servers added via the session UI (the primary use case for the marketplace)
- **Agent-runner**: Correctly resolves "all tools" to explicit names, preventing Graphton validation failures
- **Server backends**: OAuth token injection covers the full set of MCP servers (agent + session)
- **Frontend**: Connection status badge is accurate for cross-org public MCP servers

## Related Work

- [OAuth connect flow](2026-04-11-101803-t03-backend-oauth-connect-flow-token-refresh.md) — initial OAuth infrastructure
- [Managed environment service](2026-04-11-191519-managed-environment-service-oauth-token-storage.md) — token storage layer
- [Grant status frontend](2026-04-11-200706-frontend-oauth-grant-status-session-composer.md) — initial grant status UI
- [Fix connect org mismatch](2026-04-11-215022-fix-connect-org-mismatch-grant-lookup.md) — related org mismatch fix in connect flow

---

**Status**: Production Ready
**Timeline**: ~3 hours (investigation via MongoDB + implementation + tests)
