# Fix Recursion Limit: Increase to 6000 Super-steps

**Date**: March 12, 2026

## Summary

Increased the LangGraph recursion limit default to 6000 super-steps. The
previous value of 1000 (set in Session 7) was still insufficient because
the active middleware stack — enabled by the guardrails project itself —
consumes significantly more super-steps per round than the mock-tested ~6.
Loop detection middleware is the primary behavioral safety mechanism; the
recursion limit serves as a hard cost ceiling.

## Problem Statement

After the Session 7 fix (100 → 1000 super-steps), production testing
revealed agents were still hitting the recursion limit prematurely. An
execution that completed 79 tool calls was terminated at "300 events",
despite the 1000 super-step limit being active.

### Root Cause

The per-round super-step cost in production is higher than the ~6 measured
in mock tests. Each middleware hook is a separate LangGraph graph node,
and with loop detection, context summarization, and execution budget
middleware all active, the actual cost per round is substantially higher.
Before the guardrails project, these middleware were dead code (using
invalid hook names), so the pre-project 1000 super-step limit afforded
~333 rounds. With working middleware, the same 1000 super-steps only
provided ~50-80 rounds.

## Solution

Set the default recursion limit to 6000 super-steps to provide a generous
budget for complex, long-running tasks. Loop detection middleware (7
consecutive / 20 total duplicate patterns) is the primary behavioral safety
mechanism. The execution budget middleware warns at ~80% of the budget.

## Implementation Details

### Files Changed (9 files, 142 insertions, 126 deletions)

**Source code (4 files):**
- `graphton/core/agent.py` — Default `recursion_limit`: 1000 → 6000
- `graphton/core/execution_budget.py` — Default: 1000 → 6000, updated docstrings
- `graphton/core/config.py` — `AgentConfig` default: 1000 → 6000, warning threshold: >5000 → >30000
- `execute_graphton.py` — max_tool_rounds cap: 500 → 1000, default reference updated

**Proto (1 file):**
- `spec.proto` — `max_tool_rounds` comments rewritten: added Conversion section
  explaining super-steps, updated formula (×2 → ×6), default (100 → 6000),
  valid range (10–250 → 10–1000 rounds), and safety philosophy

**Tests (2 files):**
- `test_execution_budget.py` — Fixtures use 6000, warning round recalculated
  (132 → 800 for 80%, 149 → 900 for 90%), "very large" test uses 30000
- `test_recursion_limit.py` — Platform default tests use 6000, validation
  boundary tests updated (5000/5001 → 30000/30001), max tool rounds mapping
  updated (3000 → 6000)

**Documentation (2 files):**
- `design-decisions/001-recursion-limit-value.md` — Session 8 revision
- `next-task.md` — D1 description updated

## Benefits

- Generous budget for complex agent tasks (comparable to pre-guardrails capacity)
- Loop detection is the primary safety — catches repetitive patterns regardless of budget
- Execution budget warning fires at ~80%, giving the model time to wrap up
- Proto comments now accurately document the conversion formula and defaults

## Impact

- **All agent executions**: Immediately benefit from the increased limit
- **Long-running tasks**: Can complete complex multi-step workflows without premature termination
- **Proto API documentation**: Now reflects accurate conversion formula and safety philosophy

## Related Work

- Follows from Session 7 fix (100 → 1000 super-steps, commit `732efd40`)
- Part of "Agent Execution Consistency Guardrails" project (20260312.01)
- Loop detection middleware (added in same project) is the primary behavioral safety

---

**Status**: ✅ Production Ready
**Timeline**: Investigation + fix completed in same session
