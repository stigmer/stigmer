# Phase 3B: Tool Result Truncation & Cost Cap Middleware

**Date**: March 13, 2026

## Summary

Implemented two new graphton middlewares — `ToolTruncationMiddleware` and `CostCapMiddleware` — that enforce per-tool-result character limits and execution cost ceilings. These are runtime safety mechanisms that prevent context window blowup from oversized tool outputs and protect against runaway agent costs, covering all tools uniformly (platform, MCP, and resource tools).

## Problem Statement

Agent executions faced two uncontrolled cost/quality risks:

### Pain Points

- **Uncapped tool output**: MCP tools, resource tools, and shell commands could return arbitrarily large results (50K–200K+ characters), blowing up the LLM's context window and degrading response quality. Only platform tools had a hardcoded 120K truncation limit.
- **No cost ceiling**: A runaway agent could consume unlimited API credits with no warning or termination. There was no mechanism to warn the model when costs approached a budget or to gracefully stop execution.
- **StatusBuilder misplacement**: The original task file specified both features in `StatusBuilder`, which is an event observer that cannot modify the LLM's conversational state or control execution flow. This would have been architecturally incorrect.

## Solution

Followed the established `AgentMiddleware` pattern used by `ExecutionBudgetMiddleware` and `LoopDetectionMiddleware` — creating two new middlewares that hook into the LangGraph execution loop where they can actually modify state and control tool execution.

## Implementation Details

### ToolTruncationMiddleware (`graphton/core/tool_truncation.py`)

- **Hook**: `awrap_tool_call` — wraps every tool call, truncates results exceeding `max_chars`
- **Strategy**: Prefix-only (`content[:limit] + marker`). Acts as a "context budget" layer above the existing 120K head+tail truncation in `tool_wrappers.py`. Two layers, two purposes: smart formatting (120K) vs budget enforcement (30K)
- **Coverage**: ALL tools — platform, MCP, resource. Unlike the existing `truncate_tool_output()` which only covers platform tools
- **Always active**: Injected by default with 30K char limit (~7,500 tokens). `max_tool_result_chars=0` means "use platform default", not "disable"
- **Usage tracking**: Optional `on_truncation` callback feeds `UsageTracker.record_tool_truncation()` → `UsageMetrics.tool_result_chars_truncated`

### CostCapMiddleware (`graphton/core/cost_cap.py`)

- **Hooks**: `aafter_model` (cost accumulation + warning/termination) + `awrap_tool_call` (tool blocking)
- **Warning (80%)**: Injects a SystemMessage asking the model to wrap up. Fires once.
- **Exceeded (100%)**: Injects a "budget exhausted, summarize" SystemMessage + blocks all tools. The model gets one final tool-free round to produce a summary, then the graph terminates naturally.
- **Independent cost tracking**: Tracks its own running cost separate from `UsageTracker`. Different timing (middleware fires before event stream), layer (graphton library vs agent-runner service), and precision (rough estimate vs exact per-model accounting).
- **Pricing**: Rates passed at construction time from `ModelRegistry` via `execute_graphton.py`. The middleware has no dependency on `ModelRegistry`.

### Wiring

- `create_deep_agent()`: 4 new parameters (`max_tool_result_chars`, `tool_truncation_callback`, `max_cost_usd`, `cost_pricing`). Middleware injection follows existing patterns.
- `execute_graphton.py`: Reads `ExecutionConfig` fields, builds pricing dict from `ModelRegistry`, creates truncation callback closure → `UsageTracker`.
- `UsageTracker`: New `record_tool_truncation()` method, `tool_chars_truncated` on `_ScopeState`, wired into `build_usage_metrics()`.

### Tests

- 21 tests for `ToolTruncationMiddleware` (constructor, pass-through, truncation, callbacks, lifecycle)
- 22 tests for `CostCapMiddleware` (constructor, cost accumulation, warning, exceeded, tool blocking, full escalation)
- 5 tests for `UsageTracker.record_tool_truncation` (single, multiple, scoped, alongside LLM calls)
- All 128 middleware tests pass, all 28 usage tracker tests pass

## Benefits

- **Universal tool protection**: Every tool (platform, MCP, resource) is now protected against context blowup — previously only 6 platform tools were covered
- **Configurable limits**: Users can tune `max_tool_result_chars` via `ExecutionConfig` (power users can raise above 30K)
- **Graceful cost control**: Budget warnings give the model time to wrap up, and graceful termination preserves a useful summary instead of a hard crash
- **Observable**: Truncation counts flow to `UsageMetrics.tool_result_chars_truncated` for tuning and monitoring

## Impact

- **Agent-runner**: New middleware injected into every agent execution (truncation always, cost cap when configured)
- **Graphton library**: Two new modules in the core middleware stack
- **Proto schema**: No changes — `ExecutionConfig.max_tool_result_chars`, `max_cost_usd`, and `UsageMetrics.tool_result_chars_truncated` fields were already defined in Phase 1
- **Users**: Protected by default — no opt-in required for truncation. Cost cap requires explicit configuration.

## Related Work

- [Phase 1: Usage Metrics Schema Foundation](2026-03-13-102447-usage-metrics-schema-foundation.md) — defined the proto fields consumed here
- [Phase 3: Usage Metrics Population Pipeline](2026-03-13-113256-phase-3-usage-metrics-population-pipeline.md) — `UsageTracker` extraction that this extends
- [Tool Output Safety Limits](2026-03-12-183317-tool-output-safety-limits.md) — the 120K hardcoded truncation this middleware sits above
- Phase 3B plan: `.cursor/plans/phase_3b_implementation_4797ea64.plan.md`

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
