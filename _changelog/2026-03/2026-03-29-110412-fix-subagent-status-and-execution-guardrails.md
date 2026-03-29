# Fix Sub-Agent Status Timing and Execution Guardrails

**Date**: March 29, 2026

## Summary

Two sub-agent execution issues are resolved: premature "Completed" status badges appearing while tool calls still stream in, and unbounded sub-agent execution where the model continues calling tools indefinitely without loop detection, budget warnings, or recursion limits. The fixes introduce a deferred completion flush mechanism and auto-inject guardrail middleware into sub-agent graphs.

## Problem Statement

Sub-agents compiled via `compile_subagent_with_proxy` lacked the safety middleware that the main agent receives from `create_deep_agent`. This created two user-visible problems observed in production.

### Pain Points

- **Premature completion badge**: Sub-agent marked "Completed" in the UI while messages and tool calls continued streaming underneath, creating a contradictory user experience
- **Unbounded execution**: Sub-agents ran for 3+ hours and accumulated 186+ tool calls because they had no recursion limit, no loop detection, no execution budget warning, and no tool truncation
- **No graceful termination**: The model would output text like "Now I have all the data" alongside tool calls in the same turn, and with no budget middleware to tell it to wrap up, the ReAct loop continued indefinitely

## Solution

### Issue 1: Deferred Completion Flush

Replaced the immediate `force_next_update = True` on sub-agent completion with a 300ms drain window. Late LangGraph events (final `on_chat_model_end`, nested `on_tool_end`) are now batched into the same gRPC update that carries the `SUB_AGENT_COMPLETED` status, preventing the UI from showing "Completed" while activity still streams.

### Issue 2: Sub-Agent Guardrail Middleware Injection

Enhanced `compile_subagent_with_proxy` to automatically inject the same guardrail middleware that the main agent receives:

| Guardrail | Before | After |
|---|---|---|
| `recursion_limit` | None (unlimited) | 50 (configurable) |
| `LoopDetectionMiddleware` | Missing | Auto-injected |
| `ExecutionBudgetMiddleware` | Missing | Auto-injected (80% warning) |
| `ToolTruncationMiddleware` | Missing | Auto-injected (30K chars) |

## Implementation Details

### `status_builder.py`
- Added `_pending_completion_flush: dict[str, float]` — records monotonic timestamps when sub-agents complete instead of forcing an immediate gRPC push
- Added `should_flush_completions()` method with configurable `_COMPLETION_DRAIN_MS = 300` threshold
- Removed `self.force_next_update = True` from `_handle_sub_agent_end`

### `streaming.py`
- Integrated `should_flush_completions(time.monotonic())` into `_maybe_send_update` as an additional flush trigger alongside the normal scheduler

### `interrupt_proxy.py`
- Added `recursion_limit` parameter to `compile_subagent_with_proxy` (default: 50)
- Auto-injects `LoopDetectionMiddleware`, `ExecutionBudgetMiddleware`, and `ToolTruncationMiddleware`
- Applies recursion limit via `.with_config()` on the compiled graph

### `agent.py`
- Forwards parent `recursion_limit` to `compile_subagent_with_proxy` for both explicit sub-agents (HITL branch) and the deferred GP sub-agent compilation

## Benefits

- **Accurate status representation**: "Completed" badge now appears only after all events are flushed, eliminating the contradictory UI state
- **Bounded sub-agent execution**: 50 super-step limit (~25 tool-call rounds) prevents 3h+ runaway executions
- **Graceful degradation**: Budget warning at 80% (step 40) tells the model to wrap up before the hard limit hits
- **Loop detection**: Repetitive tool-call patterns are detected and interrupted, preventing infinite loops
- **Cost control**: Tool truncation prevents context blowup from oversized tool results

## Impact

- **Agent Runner**: Sub-agents now have parity with the main agent's safety net
- **CLI / Web UI**: Status badges accurately reflect sub-agent lifecycle
- **Cost**: Prevents runaway sub-agent executions that accumulate hundreds of tool calls and hours of LLM time

## Related Work

- `2026-03-29-080321-gated-general-purpose-sub-agent.md` — introduced gated GP sub-agent for HITL flows
- `2026-03-29-083706-fix-gp-subagent-compiled-without-tools.md` — fixed GP sub-agent receiving no tools
- `2026-03-29-095041-fix-interrupt-proxy-callback-context.md` — restored callback context propagation for sub-agent UI visibility

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (analysis + implementation + testing)
