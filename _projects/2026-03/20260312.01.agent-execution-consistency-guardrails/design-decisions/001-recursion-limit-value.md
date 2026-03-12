# Design Decision 001: Recursion Limit Value

**Date**: 2026-03-12
**Status**: Revised (Session 9 — Unlimited by Default)
**Decided by**: User + AI (collaborative)

## Context

The original "Agent Execution Consistency Guardrails" project reduced the
recursion limit from 1000 to 100 super-steps. Successive sessions discovered
the actual per-round cost was much higher than estimated, and even 6000
super-steps proved insufficient for complex agent tasks. The fundamental
insight: **loop detection middleware is a better safety mechanism than a
hard recursion limit.**

### Revision History

- **Session 7**: Fixed ~2 → ~6 super-steps/round ratio, set default to 1000
- **Session 8**: Production testing showed 1000 was still too low, increased to 6000
- **Session 9**: Even 6000 was insufficient (3990 events consumed). Switched to
  **unlimited by default**, with loop detection as the primary safety mechanism.

## Decision

**Default `recursion_limit` is `None` (unlimited).** No artificial super-step
ceiling is imposed by graphton. Loop detection middleware is the primary
behavioral safety mechanism. Per-execution limits can be set via
`max_tool_rounds` in `ExecutionConfig`.

## Rationale

### Why Unlimited

1. **The recursion limit kept being too low.** We went from 100 → 1000 → 6000,
   and each time production executions hit the ceiling. The per-round super-step
   cost is not a fixed constant — it depends on the active middleware stack and
   varies between mock tests and production.

2. **Loop detection is a better safety mechanism.** It catches *behavior*
   (repetitive patterns: 7 consecutive / 20 total duplicate tool calls) rather
   than counting opaque super-steps. A stuck agent loops; a productive agent
   making many tool calls should not be killed.

3. **Industry precedent.** Claude Code has no limit. Cursor's long-running
   agents run unbounded. The trend is toward letting agents run until the task
   completes or the user intervenes.

4. **Per-execution override exists.** `max_tool_rounds` in `ExecutionConfig`
   allows per-execution limits when needed (e.g. cost-sensitive deployments).

### What Happens When `recursion_limit=None`

- `create_deep_agent()` does **not** call `with_config({"recursion_limit": ...})`
- LangGraph's own `DEFAULT_RECURSION_LIMIT` (10,000) applies as the framework ceiling
- `ExecutionBudgetMiddleware` is **not injected** (no limit to warn about)
- This also reduces per-round super-step cost by one (one fewer after_model node)

### What Happens When `max_tool_rounds` Is Set

- Orchestrator computes `recursion_limit = max_tool_rounds × 6`
- `create_deep_agent()` calls `with_config({"recursion_limit": N})`
- `ExecutionBudgetMiddleware` IS injected with the explicit limit
- Warning fires at ~80% of the budget

## Configurability

`max_tool_rounds` in `ExecutionConfig` proto allows per-execution overrides:

- `0` (default) = unlimited
- `10–1000` = explicit limit, converted to `recursion_limit = rounds × 6`

The conversion formula `× 6` is a floor estimate; actual cost per round
may be higher depending on the middleware stack.

## Consequences

- Agent executions run until task completion or loop detection
- No more premature `GraphRecursionError` kills
- Loop detection (7 consecutive / 20 total) is the primary behavioral safety
- Per-execution `max_tool_rounds` provides opt-in cost ceiling when needed
- ExecutionBudgetMiddleware is skipped entirely in unlimited mode, reducing overhead
