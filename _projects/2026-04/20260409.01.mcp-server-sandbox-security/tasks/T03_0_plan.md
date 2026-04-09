# Task T03: Wire Sandbox MCP Execution into the Agent Pipeline

**Created**: 2026-04-09
**Status**: COMPLETE
**Estimated Effort**: 1 session
**Depends On**: T02 (Daytona stdio relay must be built)

## Objective

Integrate the Daytona stdio relay (T02) into the agent execution pipeline so that stdio MCP servers are automatically routed through the sandbox in cloud mode, while maintaining local subprocess execution for local/OSS mode.

## Background

The agent execution pipeline currently handles MCP servers through several layers:
1. `config_transformer.py` -- transforms `McpServerSpec` protos to `MultiServerMCPClient` config dicts
2. `setup.py` -- fetches MCP servers, backfills discovery, calls `create_deep_agent` with MCP configs
3. Graphton `McpToolsLoader` middleware -- connects to MCP servers, loads tools, manages lifecycle
4. `execute_graphton.py` -- runs the agent, cleans up MCP middleware on teardown

All of these currently assume stdio means local subprocess. This task modifies the pipeline to route stdio through the sandbox when in cloud mode.

## Scope

### 1. Config Transformer Updates

Update `worker/mcp/config_transformer.py`:
- When sandbox is available (cloud mode), transform stdio configs differently:
  - If using Approach A (custom transport): add a `"sandbox"` key to the config dict so the relay knows to use Daytona
  - If using Approach B (HTTP bridge): transform `"transport": "stdio"` to `"transport": "streamable_http"` with the bridge URL
- `_transform_stdio_config()` gets a new parameter: `sandbox` (optional Daytona sandbox reference)
- `transform_all_mcp_configs()` gets a `sandbox` parameter, passed through from setup
- Local mode: no change, stdio configs remain as-is

### 2. Setup.py Integration

Update `worker/activities/graphton/setup.py`:
- In `perform_setup()`, after workspace provisioning and before `create_deep_agent`:
  - If cloud mode and sandbox is available:
    - Start MCP server processes in the sandbox using the Daytona stdio relay
    - Pass the sandbox reference to `transform_all_mcp_configs()`
  - If local mode: no change
- Pass sandbox-aware MCP configs to `create_deep_agent(mcp_servers=..., mcp_tools=...)`
- Handle the case where sandbox provisioning fails (graceful fallback or error)

### 3. Graphton Middleware Updates

Update `backend/libs/python/graphton/src/graphton/core/middleware.py` and `mcp_manager.py`:
- `McpToolsLoader` must handle the new transport type (Daytona relay or HTTP bridge)
- If using Approach A: `connect_mcp_client` needs to use `DaytonaStdioRelay` instead of `MultiServerMCPClient`'s default subprocess transport for sandbox-routed servers
- If using Approach B: no middleware changes needed (everything is HTTP from Graphton's perspective)
- `aafter_agent` cleanup must close Daytona relay sessions (not just `exit_stack.aclose()`)

### 4. Execute Graphton Teardown

Update `worker/activities/execute_graphton.py`:
- Ensure Daytona MCP sessions are cleaned up in the `finally` block
- Handle the case where the sandbox was recovered mid-execution (MCP servers may need restart)

### 5. Local Mode Fallback

Ensure local mode (`STIGMER_EXECUTION_MODE=local`) continues to work unchanged:
- No Daytona sandbox available
- Stdio MCP servers run as local subprocesses via `subprocess.Popen`
- All existing behavior preserved
- Gate sandbox routing on `config.is_local_mode()` or sandbox availability

## Success Criteria

- [ ] Cloud mode: stdio MCP servers run inside the Daytona sandbox
- [ ] Cloud mode: agent can invoke MCP tools and get results via the sandbox relay
- [ ] Local mode: stdio MCP servers still run as local subprocesses (no regression)
- [ ] HTTP MCP servers: no change in behavior (already remote)
- [ ] Teardown: all Daytona sessions and MCP processes cleaned up
- [ ] Sandbox recovery: MCP servers restarted if sandbox was revived

## Files to Modify

| Action | File |
|--------|------|
| Modify | `backend/services/agent-runner/worker/mcp/config_transformer.py` |
| Modify | `backend/services/agent-runner/worker/activities/graphton/setup.py` |
| Modify | `backend/services/agent-runner/worker/activities/execute_graphton.py` |
| Modify | `backend/libs/python/graphton/src/graphton/core/middleware.py` |
| Modify | `backend/libs/python/graphton/src/graphton/core/mcp_manager.py` |
| Modify | `backend/libs/python/graphton/src/graphton/core/agent.py` (if wiring changes) |

## Decision Point

The main decision (Approach A vs B from T02) affects this task significantly:
- **Approach A**: More changes in Graphton middleware, custom transport wiring
- **Approach B**: Minimal Graphton changes (everything is HTTP), but more config_transformer changes

This decision should be finalized during T02 execution based on what works best with `langchain_mcp_adapters`.

## Notes

- `setup.py` already has the sandbox reference (`sandbox` variable) available after workspace provisioning
- `sandbox_config_for_agent` dict already passes sandbox info to Graphton
- The backfill logic in `_needs_backfill()` and connect flow also start MCP servers -- those are addressed in T04
