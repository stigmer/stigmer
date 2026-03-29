# Periodic Advisory Budget Middleware for Main and Sub-Agents

**Date**: March 29, 2026

## Summary

Enhanced the `ExecutionBudgetMiddleware` to support a new **periodic advisory mode** alongside the existing threshold mode. Both the main agent and sub-agents now receive escalating nudges at regular intervals when running with effectively unlimited recursion, keeping long-running executions on track without imposing hard ceilings. This also fixes the `ValueError: Received multiple non-consecutive system messages` Anthropic API error caused by guardrail middleware injecting `SystemMessage` objects mid-conversation.

## Problem Statement

Two distinct issues converged around sub-agent execution guardrails:

### Pain Points

- **Anthropic API incompatibility**: Guardrail middlewares (`ExecutionBudgetMiddleware`, `LoopDetectionMiddleware`) inject `SystemMessage` objects mid-conversation. The Anthropic API requires all system messages to be contiguous at the start, causing `ValueError: Received multiple non-consecutive system messages` when these mid-conversation system messages hit the API.
- **Restrictive recursion limit**: The initial sub-agent `recursion_limit=50` only allowed ~8-12 model rounds (each round consumes ~6 LangGraph super-steps). Legitimate sub-agent work was hitting the budget warning and crashing with `GraphRecursionError`.
- **Lost advisory nudges**: After removing the restrictive limit and `ExecutionBudgetMiddleware`, sub-agents had no mechanism to encourage wrapping up long-running executions. The main agent (unlimited mode) also lacked any periodic guidance.

## Solution

A three-part fix addressing all three pain points:

1. **Anthropic message sanitization** — A `_sanitize_non_leading_system_messages()` function in the Anthropic model subclass converts mid-conversation `SystemMessage` objects to `HumanMessage` with a `[System]` prefix, preserving semantic intent while satisfying API constraints.

2. **Dual-mode `ExecutionBudgetMiddleware`** — The middleware now supports two operating modes:
   - **Threshold mode** (existing): Single warning at a percentage of `recursion_limit`. For agents with explicit limits.
   - **Periodic mode** (new): Advisory nudges every N model rounds with escalating urgency, up to a configurable maximum. For agents running with unlimited recursion.

3. **Wiring into both agents** — Periodic budget advisories are now active for both sub-agents (every 30 rounds) and the main agent (every 50 rounds) when running in unlimited mode.

## Implementation Details

### Periodic Mode Parameters

- `warning_interval`: Model rounds between advisories (sub-agent: 30, main agent: 50)
- `max_warnings`: Maximum advisories before going silent (both: 4)

### Escalating Message Tiers

| Advisory | Tone | Trigger |
|----------|------|---------|
| 1st | Gentle — "If nearing completion, start wrapping up" | 30/50 rounds |
| 2nd | Firm — "Prioritize completing your current task now" | 60/100 rounds |
| 3rd | Urgent — "Wrap up your work, provide findings" | 90/150 rounds |
| 4th | Critical — "Provide your final answer immediately" | 120/200 rounds |

### Files Changed

- **`execution_budget.py`** — Dual-mode middleware with `warning_interval`, `max_warnings`, and 4 escalating message templates
- **`interrupt_proxy.py`** — Re-added `ExecutionBudgetMiddleware` in periodic mode (interval=30, max=4) for sub-agents
- **`agent.py`** — Always injects budget middleware: periodic when unlimited, threshold when `recursion_limit` is set
- **`models.py`** — `_sanitize_non_leading_system_messages()` for Anthropic API compatibility
- **`test_execution_budget.py`** — 63 tests covering both threshold and periodic modes
- **`test_interrupt_proxy_guardrails.py`** — 8 tests updated for periodic budget middleware injection
- **`test_models.py`** — 11 tests for the message sanitization function

## Benefits

- **No more Anthropic API crashes** — Mid-conversation system messages are transparently converted, eliminating the `ValueError` for all guardrail middleware.
- **Long-running agents stay on track** — Periodic nudges encourage efficient task completion without hard stops, matching the approach of Cursor and Claude Code which also run sub-agents without strict limits.
- **Graceful degradation** — Escalating urgency gives models 4 chances to wrap up before the middleware goes silent, balancing thoroughness with efficiency.
- **Both agents covered** — Main agent (50-round interval) and sub-agents (30-round interval) both benefit from periodic guidance.

## Impact

- **Sub-agents**: No longer crash from restrictive recursion limits. Receive periodic nudges at rounds 30, 60, 90, 120.
- **Main agent**: Now receives periodic nudges at rounds 50, 100, 150, 200 when running in unlimited mode (the common case).
- **Anthropic users**: The `ValueError` from non-contiguous system messages is permanently resolved.
- **OpenAI/other providers**: Unaffected — the sanitization only applies to the Anthropic model subclass.

## Related Work

- Previous changelog: `2026-03-29-110412-fix-subagent-status-and-execution-guardrails.md` — Added initial guardrails to sub-agents (which triggered the Anthropic error).
- Previous changelog: `2026-03-29-080321-gated-general-purpose-sub-agent.md` — Gated GP sub-agent with InterruptProxy.

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (analysis, implementation, testing)
