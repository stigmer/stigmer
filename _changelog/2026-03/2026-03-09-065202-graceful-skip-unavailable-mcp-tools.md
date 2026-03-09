# Gracefully Skip Unavailable MCP Tools at Agent Startup

**Date**: March 9, 2026

## Summary

Changed the Graphton agent creation logic to gracefully skip MCP tools that are listed in `enabled_tools` but not actually available on the MCP server at runtime. Previously this caused a fatal `RuntimeError` that killed the entire agent execution before it could start. Now the agent logs a warning and proceeds with whatever tools are available.

## Problem Statement

When an agent's `enabled_tools` contained a name that didn't exist in the MCP server's actual tool list (e.g., a resource template name like `cloud_resource_schema`, or a tool that was removed since the agent was authored), the agent-runner crashed during startup with:

```
RuntimeError: Cannot create approval-aware wrapper for tool 'cloud_resource_schema': 
Tool 'cloud_resource_schema' not found in cache.
```

The execution was marked `EXECUTION_FAILED` before the agent even had a chance to process a single message.

### Pain Points

- A single stale or incorrect tool name in `enabled_tools` killed the entire execution
- The agent-runner already knew which tools were missing (it logged a warning from the MCP manager) but then crashed at the wrapper-creation step
- MCP servers can evolve — tools get added or removed — and agent YAML is a point-in-time snapshot
- No graceful degradation: the agent couldn't run with the 25 out of 27 tools that were actually available

## Solution

In `create_deep_agent()` within `graphton/core/agent.py`, the tool wrapper creation loop now checks if each requested tool exists in the middleware's tool cache before attempting to create a wrapper. Missing tools are skipped with a warning log, and the agent proceeds with the tools that are available.

## Implementation Details

Changed the wrapper creation loop in `create_deep_agent()`:

- **Before**: Iterates over all `tool_names` from `mcp_tools` and calls `create_approval_aware_tool_wrapper()` (or `create_tool_wrapper()`) for each. If any tool is missing, the wrapper function raises `RuntimeError`, killing the execution.

- **After**: Checks `tool_name not in mcp_middleware._tools_cache` before creating wrappers. Missing tools are collected into a `skipped_tools` list, logged individually with a descriptive warning, and skipped. After the loop, a summary warning logs how many tools were skipped vs. available.

The warning message specifically mentions that the cause might be a resource template name in `enabled_tools` or a removed tool, guiding operators to the root cause.

## Benefits

- **Resilient execution**: Agents run with available tools instead of crashing on startup
- **Forward-compatible**: MCP servers can add/remove tools without breaking existing agents
- **Clear diagnostics**: Warning logs identify exactly which tools were skipped and why
- **Zero behavioral change** for correct configurations: if all tools exist, no warnings, no change

## Impact

- **All agent executions**: Any agent with an `enabled_tools` mismatch will now gracefully degrade instead of crashing
- **Operator experience**: Clear warning logs instead of cryptic `RuntimeError` stack traces
- **Graphton library**: Single file change in `agent.py` — the core agent creation function

---

**Status**: ✅ Production Ready
