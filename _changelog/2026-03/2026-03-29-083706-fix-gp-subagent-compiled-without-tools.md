# Fix GP Sub-Agent Compiled Without Tools

**Date**: March 29, 2026

## Summary

Fixed a critical bug where the gated general-purpose sub-agent was compiled with zero tools, causing the model to output tool calls as raw XML text instead of using native function calling. The root cause was a timing issue in `create_deep_agent()` where the GP sub-agent was compiled before sandbox platform tools and MCP tools were added to the tool list. The fix defers GP sub-agent compilation until all tools are available.

## Problem Statement

After the `2026-03-29-080321-gated-general-purpose-sub-agent` change injected an explicit gated "general-purpose" `CompiledSubAgent` into the HITL pipeline, production executions showed raw `<tool_calls>` XML markup appearing as plain text in the UI instead of structured tool call cards.

### Pain Points

- Users saw raw XML/JSON tool call text in the conversation thread instead of interactive tool cards
- The GP sub-agent could not actually execute any tools (shell, read, write, etc.) — it was functionally useless despite being compiled
- The code comment at the compilation site described deferred tool assignment, but the deferral was never implemented
- The bug only affected the GP sub-agent in HITL mode — explicit sub-agents (from `subagent_transformer.py`) were unaffected because they create their own platform tool wrappers

## Solution

Deferred GP sub-agent compilation from the HITL branch (where tools aren't yet available) to after sandbox platform tools and MCP tools are created. The GP sub-agent now receives its own set of platform tool wrappers with `sub_agent_name="general-purpose"` for correct HITL interrupt routing.

## Implementation Details

### Restructured GP sub-agent lifecycle in `agent.py`

The previous structure compiled the GP sub-agent eagerly inside the HITL branch with `tools=list(tools or [])`, where `tools` is the function parameter (always `None` from `execute_graphton.py`). Platform tools are added to `tools_list` 200+ lines later.

**Phase A — Store injection intent:** The HITL branch now stores `_pending_gp_config` (model, system_prompt, middleware) and `_hitl_gate` reference instead of calling `compile_subagent_with_proxy()`.

**Phase B — Deferred compilation:** After sandbox platform tools, MCP tools, and the think tool are all created, a new block:
1. Creates **separate** platform tool wrappers with `sub_agent_name="general-purpose"` for correct interrupt payload tagging
2. Includes MCP tool wrappers from the main agent (if available)
3. Includes the think tool (if not native thinking)
4. Compiles the GP sub-agent with the full tool set via `compile_subagent_with_proxy()`
5. Wraps with `_hitl_gate.wrap()` and appends to `transformed_subagents`
6. Skips injection gracefully (with warning) if no tools are available — a GP sub-agent without tools is worse than no GP sub-agent

### Outer-scope variable initialization

Added `_hitl_gate`, `_pending_gp_config`, `mcp_tool_wrappers`, and `sandbox_backend` initializations at outer scope so the deferred compilation block can access state from earlier conditional branches.

### Tests

- 6 existing `TestGatedGeneralPurposeSubAgent` tests pass unchanged (the mock patching covers both the HITL import and the deferred import of `compile_subagent_with_proxy`)
- Added `test_gp_subagent_receives_platform_tools` — verifies GP sub-agent's `compile_subagent_with_proxy()` call receives platform tools when sandbox is configured
- Added `test_gp_platform_tools_tagged_with_sub_agent_name` — verifies `create_platform_tool_wrappers` is called with `sub_agent_name="general-purpose"` for correct HITL interrupt routing
- Added `test_gp_subagent_skipped_when_no_tools_available` — verifies GP injection is skipped when no sandbox, MCP, or think tool is available (native thinking model, no sandbox, no MCP)

## Benefits

- **Production unblocked**: GP sub-agent now uses native function calling — tool calls appear as structured cards in the UI, not raw XML text
- **Correct HITL routing**: GP sub-agent platform tools carry `sub_agent_name="general-purpose"` in interrupt payloads, matching the pattern established by `subagent_transformer.py` for explicit sub-agents
- **Graceful degradation**: If no tools are available (unusual edge case), the GP sub-agent is not injected rather than being injected as a useless tool-less agent
- **No behavior change for other paths**: Explicit sub-agents, non-HITL path, and the main agent are completely unaffected

## Impact

- **Agent Runner**: All HITL agent executions using the general-purpose sub-agent now have a properly tooled GP delegate
- **UI**: Tool calls from the GP sub-agent render as interactive cards instead of raw text
- **Test coverage**: 1254 graphton tests pass, 1359 agent-runner tests pass, ruff clean

## Related Work

- `2026-03-29-080321-gated-general-purpose-sub-agent.md` — introduced the gated GP sub-agent (with the zero-tools bug)
- `2026-03-29-042152-fix-excessive-sub-agent-spawning.md` — introduced the `SubAgentGate` and concurrency controls that the GP sub-agent shares

---

**Status**: Production Ready
**Timeline**: Single session
