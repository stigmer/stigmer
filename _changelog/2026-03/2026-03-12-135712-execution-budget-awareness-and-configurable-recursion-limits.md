# Execution Budget Awareness and Configurable Recursion Limits

**Date**: March 12, 2026

## Summary

Added two complementary enhancements to the agent execution pipeline: (1) an `ExecutionBudgetMiddleware` that proactively warns the LLM when it's approaching its execution budget, enabling graceful wrap-up instead of hard termination, and (2) per-execution recursion limit configurability via a new `max_tool_rounds` proto field. Together these close the remaining gaps from the original recursion limit fix (PR3), giving both operators and end-users control over execution length with a smooth degradation experience.

## Problem Statement

After the PR3 recursion limit fix hardcoded the limit at 100 super-steps (~50 model→tools rounds), two gaps remained:

### Pain Points

- **Hard termination with no warning**: When the agent hit the recursion limit, LangGraph raised `GraphRecursionError` — the agent had no opportunity to summarize its work or provide a coherent final response. Users saw an abrupt "execution failed" with no context about what was accomplished.
- **One-size-fits-all limit**: The hardcoded 100 super-steps was a reasonable default, but complex workflows (multi-step code generation, deep research tasks) sometimes needed more room, while simple Q&A tasks wasted budget. There was no way to tune this per-execution.
- **Operator blindness**: No logging or metrics indicated how close an execution was to its budget, making capacity planning difficult.

## Solution

Two-layer approach: a library-level middleware for budget awareness (PR6/D2) and a proto-level configuration field for per-execution tuning (PR7/D1).

## Implementation Details

### PR6: ExecutionBudgetMiddleware

New middleware in graphton's core layer, following the same `AgentMiddleware` hook pattern as `LoopDetectionMiddleware`:

- **`aafter_model` hook**: Increments a model-round counter after each LLM response. When the counter reaches ~80% of the estimated budget (configurable via `budget_warning_pct`), injects a `SystemMessage` asking the model to prioritize wrapping up.
- **Single-fire design**: The warning message is injected exactly once per agent invocation — no repeated nagging that would confuse the model or waste tokens.
- **`abefore_agent` hook**: Resets counters for each new invocation, supporting multi-turn conversations where the agent is invoked multiple times.
- **`aafter_agent` hook**: Logs final budget usage statistics for observability.
- **Separation from loop detection**: Deliberately a separate middleware — budget tracking (resource management) is a different concern from loop detection (behavioral pattern detection). Each has its own lifecycle, configuration, and evolution path.

Configuration added to `AgentConfig`:
- `budget_warning_pct: int = 80` with Pydantic validation (range: 50–95)
- Exposed as `budget_warning_pct` parameter on `create_deep_agent()`

### PR7: `max_tool_rounds` Proto Field

New field on `ExecutionConfig` proto message:

- `int32 max_tool_rounds = 3` — maximum model→tools reasoning cycles per message
- Mapping: `recursion_limit = max_tool_rounds * 2` (each round = 1 model call + 1 tool execution = 2 LangGraph super-steps)
- Default: `0` = use platform default (50 rounds / 100 super-steps)
- Valid range: 10–250 rounds; out-of-range values clamped to nearest bound with warning log
- Orchestrator (`execute_graphton.py`) reads the field, computes the LangGraph `recursion_limit`, and passes it through to `create_deep_agent()`

Naming rationale: "tool rounds" is the correct domain abstraction — each round is one model→tools reasoning cycle. `max_tool_calls` was rejected because a single round can invoke multiple tools in parallel. `recursion_limit` was rejected because it leaks the LangGraph implementation detail.

## Benefits

- **Graceful degradation**: Agents now receive a proactive wrap-up signal at ~80% of their budget, allowing them to summarize progress and provide a coherent final response instead of being hard-killed
- **Per-execution tuning**: Operators can set `max_tool_rounds` per execution to match task complexity — generous for research tasks, conservative for simple queries
- **Observability**: Budget usage is logged at the end of each invocation, enabling capacity analysis
- **User experience parity**: Mirrors Cursor's "Continue" pattern — users see a meaningful stopping point rather than an error
- **Clean architecture**: Separate middleware keeps concerns isolated; budget awareness works with any recursion limit (default or custom)

## Impact

- **End users**: More reliable and predictable agent behavior — agents wrap up gracefully instead of crashing
- **Operators**: New `max_tool_rounds` knob for per-execution control; budget logs for monitoring
- **Developers**: Clean middleware pattern that can be extended (e.g., token-based budgeting, cost-based limits)
- **Platform**: Closes the last two deferred items from the original recursion limit investigation

## Related Work

- PR3: Original recursion limit fix (hardcoded at 100, `GraphRecursionError` handler) — this work extends it
- PR1: Loop detection middleware fix — established the `aafter_model` + `awrap_tool_call` hook pattern reused here
- Design decision `001-recursion-limit-value.md` — rationale for the 100 super-step default
- Cursor's 25-tool-call limit and "Continue" UX — industry reference for the user experience pattern

---

**Status**: Production Ready
**Timeline**: Session 6 of project 20260312.01.agent-execution-consistency-guardrails
