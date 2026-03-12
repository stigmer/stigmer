# Make Recursion Limit Unlimited by Default

**Date**: March 12, 2026

## Summary

Changed the default recursion limit from a fixed value (6000 super-steps)
to unlimited (`None`). Loop detection middleware is now the sole behavioral
safety mechanism. The `ExecutionBudgetMiddleware` is only injected when
an explicit limit is set via `max_tool_rounds`. This eliminates premature
agent termination from `GraphRecursionError` while reducing per-round
super-step cost.

## Problem Statement

Successive attempts to find the "right" recursion limit failed:
- 100 super-steps: agents died after ~16 rounds
- 1000 super-steps: agents died after ~50-80 rounds
- 6000 super-steps: agent still hit the limit at 3990 events

The per-round super-step cost is not a fixed constant — it depends on the
active middleware stack and varies between mock tests and production. Any
fixed limit was either too restrictive for complex tasks or required
constant tuning.

### Pain Points

- Complex tasks (e.g. multi-step skill creation) consistently hit the limit
- Each increase required code changes across 7+ files and test updates
- The recursion limit was fighting against productive work, not just loops

## Solution

Make `recursion_limit=None` the default, meaning "no artificial limit".
Loop detection middleware (7 consecutive / 20 total duplicate patterns)
catches stuck agents regardless of super-step count. Per-execution limits
remain available via `max_tool_rounds` in `ExecutionConfig` proto.

## Implementation Details

### Behavioral Change

| Scenario | Before | After |
|----------|--------|-------|
| Default execution | 6000 super-step ceiling | Unlimited (framework default) |
| `max_tool_rounds` set | `rounds × 6` super-steps | Same — explicit limit applied |
| ExecutionBudgetMiddleware | Always injected | Only when limit is set |
| Loop detection | Active | Active (unchanged) |

### Files Changed

**Source code:**
- `graphton/core/agent.py` — `recursion_limit: int | None = None`; skip
  `with_config` and `ExecutionBudgetMiddleware` when None
- `graphton/core/config.py` — `AgentConfig` default to None; simplified validator
- `graphton/core/execution_budget.py` — Updated module docstring
- `execute_graphton.py` — Comments updated for unlimited default

**Proto:**
- `spec.proto` — `max_tool_rounds` comments: "0 = unlimited"

**Tests:**
- `test_recursion_limit.py` — New tests for None default: `test_default_is_none`,
  `test_default_none_skips_with_config`, removed warning threshold tests
- `test_execution_budget.py` — Unchanged (tests explicit limits, still valid)

**Documentation:**
- `design-decisions/001-recursion-limit-value.md` — Session 9 revision

## Benefits

- No more premature agent termination from `GraphRecursionError`
- One fewer middleware hook per round in unlimited mode (lower overhead)
- Loop detection is the right abstraction for safety — catches behavior, not counts
- Per-execution `max_tool_rounds` available when cost ceiling is needed

## Impact

- **All agent executions**: Run until task completion or loop detection
- **Complex tasks**: No longer constrained by arbitrary super-step ceiling
- **Per-round cost**: Slightly lower (one fewer after_model node when unlimited)

## Related Work

- Follows from Session 7 (100→1000) and Session 8 (1000→6000) fixes
- Part of "Agent Execution Consistency Guardrails" project (20260312.01)
- Loop detection middleware is the cornerstone safety mechanism

---

**Status**: ✅ Production Ready
