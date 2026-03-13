# Design Decision 001: Recursion Limit Value

**Date**: 2026-03-12
**Status**: Revised (Session 11 — Set at the Right Layer)
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
- **Session 10**: Discovered deepagents sets its own `recursion_limit=1000`
  internally; skipping `with_config` inherited that ceiling. Added explicit 10M
  override via `with_config`.
- **Session 11**: Still hitting limits (1197 events). Root-caused to `with_config`
  being the wrong layer entirely. Fixed by setting limit in **invoke config**
  (highest priority in merge chain) and `LANGGRAPH_DEFAULT_RECURSION_LIMIT`
  env var (framework-wide default).

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

### Three Layers of Defense (Session 11)

The recursion limit is now enforced at three independent layers:

1. **`LANGGRAPH_DEFAULT_RECURSION_LIMIT` env var** (framework-wide default)
   - Set to `10000000` in `daemon_process.go` `buildAgentRunnerEnv()`
   - Changes LangGraph's `DEFAULT_RECURSION_LIMIT` at import time
   - Covers ALL graphs including deepagents' subagents

2. **Invoke config** (highest priority, top-level graph)
   - `recursion_limit` is passed directly in the config dict to `astream_events()`
   - This is the LAST config in LangGraph's `merge_configs` chain — it wins
   - When `max_tool_rounds` is unset: `10_000_000` (unlimited)
   - When `max_tool_rounds` is set: `clamped_rounds × 6`

3. **graphton's `with_config`** (belt-and-suspenders)
   - `create_deep_agent()` calls `with_config({"recursion_limit": N})`
   - Redundant with layers 1 and 2 but retained as defense-in-depth

### Why `with_config` Alone Was Not Enough

DeepAgents' `create_deep_agent()` returns
`create_agent(...).with_config({"recursion_limit": 1000})`. Graphton chains
`.with_config({"recursion_limit": 10M})` on top. Between these nested
`RunnableBinding` layers and Pregel's internal `ensure_config()`, the final
`recursion_limit` that Pregel's execution loop uses is not deterministic
from the caller's perspective. The invoke config bypasses all of this.

### What Happens When `recursion_limit=None` (Default)

- Invoke config sets `recursion_limit=10_000_000` (effectively unlimited)
- `LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000` covers subagent graphs
- `ExecutionBudgetMiddleware` is **not injected** (no budget to warn about)
- Loop detection is the sole behavioral safety mechanism

### What Happens When `max_tool_rounds` Is Set

- Orchestrator computes `recursion_limit = max_tool_rounds × 6`
- Invoke config uses the computed value
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
