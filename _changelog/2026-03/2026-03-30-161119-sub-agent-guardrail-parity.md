# Sub-Agent Guardrail Parity with Main Agent

**Date**: March 30, 2026

## Summary

Closed the gap between main agent and sub-agent execution guardrails. Sub-agents now share the parent's cost cap budget, receive summarization observability callbacks, get the think tool when the model lacks native extended thinking, and benefit from the same tool count/description auditing as the main agent. These changes bring Stigmer's sub-agent execution on par with how Cursor and Claude Code enforce cost, context, and reasoning constraints across delegated work.

## Problem Statement

The main agent (`create_deep_agent`) had five execution-level guardrails and optimisations that sub-agents (`compile_subagent`) did not receive, creating asymmetric safety and observability between parent and child executions.

### Pain Points

- **Runaway cost**: A sub-agent could burn unlimited API credits while the parent's `CostCapMiddleware` only tracked the parent's own model calls — the highest severity gap.
- **Blind spots in context management**: Sub-agent `ContextSummarizationMiddleware` was created with `callback=None`, so token counts, compression ratios, and summarization events were invisible to `StatusBuilder` and the UI.
- **No structured reasoning for non-thinking models**: Explicit sub-agents (proto-defined via `SubAgent`) never received the think tool, leaving models without native extended thinking unable to do structured reasoning.
- **No tool hygiene warnings**: Tool count warnings (>25 tools degrades selection accuracy) and description truncation (caps verbose MCP descriptions) only ran for the main agent.

## Solution

Four targeted, additive changes — no architectural shifts, no new proto fields, no new RPCs.

1. **Shared cost cap via view pattern**: `CostCapMiddleware.for_sub_agent()` returns a `_CostCapSubAgentView` that delegates `aafter_model` and `awrap_tool_call` to the parent instance while making `abefore_agent` a no-op. This ensures sub-agent model calls accumulate against the same budget without resetting the parent's running cost.

2. **Summarization callback threading**: All four code paths that inject `ContextSummarizationMiddleware` into sub-agents now pass `callback=summarization_callback` instead of `callback=None`.

3. **Think tool injection for explicit sub-agents**: `_transform_single_subagent` now checks whether the resolved model (parent or override) has native thinking via `ModelRegistry`, and injects `create_think_tool()` when it doesn't.

4. **Shared `audit_tool_set` utility**: Extracted tool count warning and description truncation into `audit_tool_set()` in `subagent.py`, called from both `create_deep_agent` and `compile_subagent`.

## Implementation Details

### Files Changed (7 files, +417 / -52 lines)

**graphton library (core)**:
- `cost_cap.py` — Added `for_sub_agent()` factory method and `_CostCapSubAgentView` class (56 new lines). The view uses `__slots__` for minimal overhead and delegates all cost accounting to the parent.
- `subagent.py` — Added `cost_cap` parameter to `compile_subagent()`, added `audit_tool_set()` shared utility function with `_TOOL_COUNT_WARNING_THRESHOLD` and `_TOOL_DESC_MAX_CHARS` constants.
- `agent.py` — Hoisted `_cost_cap` to outer scope, threaded `for_sub_agent()` views and `summarization_callback` into all three sub-agent compilation paths (HITL explicit, HITL GP deferred, non-HITL). Replaced 30 lines of inline tool auditing with `audit_tool_set()` call.

**agent-runner service**:
- `subagent_transformer.py` — Added `parent_has_native_thinking` parameter, think tool injection logic using `ModelRegistry` for override models.
- `setup.py` — Passes `parent_has_native_thinking` computed from `model_metadata`.

**Tests**:
- `test_cost_cap.py` — 8 new tests for `_CostCapSubAgentView` covering: no-reset on `abefore_agent`, shared cost accumulation, warning propagation, tool blocking, combined parent+view budget.
- `test_subagent_guardrails.py` — 8 new tests: 3 for cost cap injection in `compile_subagent`, 5 for `audit_tool_set` (threshold warning, truncation, preservation, empty list).

### Design Decisions

- **View pattern over shared instance**: Sharing `CostCapMiddleware` directly would cause `abefore_agent` to reset the parent's accumulated cost when a sub-agent starts. The view pattern preserves field ownership (parent owns lifecycle reset) while enabling shared cost tracking.
- **Same callback, not a wrapper**: Passing the parent's `summarization_callback` directly to sub-agents is simpler than creating per-sub-agent tagged wrappers. The callback protocol (`on_summarization_complete`, `on_token_count_updated`) already works in the sub-agent context because `StatusBuilder` routes events by `checkpoint_ns`.
- **Think tool only for explicit sub-agents**: Built-in sub-agents (explore, shell) are tool-restricted specialists; adding a reasoning tool doesn't align with their focused purpose.

## Benefits

- **Cost safety**: Sub-agent model calls now count toward the execution's budget cap. A runaway sub-agent triggers the same warning at 80% and tool-blocking at 100% as the parent.
- **Full observability**: Operators can now see per-sub-agent token counts and summarization events in the UI, matching what Cursor and Claude Code surface.
- **Reasoning parity**: Models without native thinking get the think tool in both main and sub-agent contexts.
- **DRY tool hygiene**: Single `audit_tool_set` function eliminates duplicated logic between `create_deep_agent` and `compile_subagent`.

## Impact

- **Agent runner service**: Sub-agent execution is now production-safe with cost guardrails.
- **Platform operators**: Can monitor sub-agent context health and costs via the same StatusBuilder observability pipeline as the main agent.
- **Test coverage**: 16 new tests; 1409 total core tests pass (same 2 pre-existing failures in `test_recursion_limit.py` unrelated to this change).

## Related Work

- [Sub-agent execution gap analysis](sub-agent_execution_gap_analysis_fa5b7623.plan.md) — Plan document produced in the prior conversation turn.
- `feat(backend): add explore and shell built-in subagent types` (4a9d15f3) — The built-in sub-agent infrastructure this builds upon.
- `fix(backend/agent-runner): correct concurrent sub-agent resume event routing` (76bb23a6) — Sub-agent event routing that complements this guardrail work.

---

**Status**: ✅ Production Ready
**Timeline**: Single session
