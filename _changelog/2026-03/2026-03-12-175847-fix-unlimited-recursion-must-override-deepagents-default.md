# Fix: Unlimited Recursion Must Explicitly Override DeepAgents Internal Limit

**Date**: March 12, 2026

## Summary

Fixed a critical bug where setting `recursion_limit=None` (our "unlimited"
approach from Session 9) caused agents to terminate even sooner than before.
The root cause: deepagents internally sets its own recursion_limit during
graph construction, and skipping `with_config` meant inheriting that much
lower ceiling instead of being truly unlimited.

## Problem Statement

After the Session 9 change to make recursion_limit unlimited by default
(`None` = skip `with_config`), agent executions hit the tool-call limit
after only 700 events — worse than the previous 6000 super-step limit
which allowed 3990 events.

### Pain Points

- Agents terminated earlier than before the "unlimited" change
- The approach assumed that not calling `with_config` would leave the
  framework's own 10,000 default in place
- In reality, deepagents' `create_deep_agent()` applies its own internal
  `recursion_limit` to the compiled graph, which is much lower

## Solution

Always call `with_config({"recursion_limit": N})` regardless of whether the
user wants unlimited or a specific limit:

- `recursion_limit=None` (default) → `with_config({"recursion_limit": 10_000_000})`
- `recursion_limit=<explicit>` → `with_config({"recursion_limit": <explicit>})`

The value 10,000,000 is chosen because:
1. It's effectively unlimited for any realistic agent execution
2. It's not equal to LangGraph's `DEFAULT_RECURSION_LIMIT` (10,000), so
   `merge_configs` won't strip it
3. It explicitly overrides whatever deepagents sets internally

## Implementation Details

### Files Changed

- `graphton/core/agent.py` — Always call `with_config`; map `None` to 10M
  via `_UNLIMITED = 10_000_000` constant
- `test_recursion_limit.py` — Updated `test_default_none_uses_unlimited` to
  verify `with_config` is called with 10M (was asserting `not_called`)
- `execute_graphton.py` — Comments updated: `None → 10M internally`
- `design-decisions/001-recursion-limit-value.md` — Documents deepagents override
- Existing changelog updated with Session 10 context

### Key Insight

The LangGraph recursion limit has three layers of defaults:
1. **LangGraph framework**: `DEFAULT_RECURSION_LIMIT = 10,000` (applied if no config)
2. **DeepAgents library**: Sets its own limit during `create_deep_agent()` graph compilation
3. **Graphton (our layer)**: Must explicitly override via `with_config` to take precedence

Skipping layer 3 doesn't fall back to layer 1 — it falls back to layer 2,
which imposes a much lower limit.

## Benefits

- Agent executions are now truly unlimited by default (10M super-step ceiling)
- Explicit `max_tool_rounds` overrides still work as expected
- Loop detection remains the primary behavioral safety mechanism

## Impact

- **All default agent executions**: Will no longer hit premature termination
- **Correctness**: `with_config` is always called, ensuring graphton's
  intent is respected regardless of deepagents' internal defaults

## Related Work

- Continuation of the recursion limit saga: Session 7 (100→1000), Session 8
  (1000→6000), Session 9 (unlimited via skip), Session 10 (this fix: unlimited
  via explicit 10M override)
- Part of "Agent Execution Consistency Guardrails" project (20260312.01)

---

**Status**: ✅ Production Ready
