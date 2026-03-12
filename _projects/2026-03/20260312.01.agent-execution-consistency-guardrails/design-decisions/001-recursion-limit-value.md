# Design Decision 001: Recursion Limit Value

**Date**: 2026-03-12
**Status**: Revised (Session 8)
**Decided by**: User + AI (collaborative)

## Context

The orchestrator (`execute_graphton.py`) was overriding graphton's default `recursion_limit` of 100 with 1000 in two places. We needed to decide what the correct default should be.

### Revision History

**Session 7**: Discovered that ~2 super-steps/round was wrong; the actual ratio is
~6 due to middleware nodes. Updated default from 100 → 1000.

**Session 8**: Production testing revealed that 1000 super-steps was still
insufficient — the active middleware stack (enabled by the guardrails project
itself) consumes significantly more super-steps per round than the mock-tested
~6. Each middleware hook is a separate LangGraph graph node, and with loop
detection, context summarization, and execution budget middleware all active,
the per-round cost is substantially higher. The default has been increased to
**6000 super-steps** to provide a generous budget for long-running agent tasks.
Loop detection middleware is the primary behavioral safety mechanism; the
recursion limit serves as a hard cost ceiling.

## Decision

**Use graphton's default of 6000 super-steps.** Do not override from the orchestrator.

## Rationale

### Super-step Cost

Each model-tool round consumes multiple LangGraph super-steps because every
middleware hook is implemented as a separate graph node:

| Node | Source |
|------|--------|
| `before_model` (SummarizationMiddleware) | middleware hook |
| `model` | core agent |
| `after_model` (ContextSummarizationMiddleware) | middleware hook |
| `after_model` (LoopDetectionMiddleware) | middleware hook |
| `after_model` (ExecutionBudgetMiddleware) | middleware hook |
| `tools` | core agent |

The minimum cost is ~6 super-steps per round, but in practice the cost is
higher due to additional internal graph transitions. The exact ratio depends
on the active middleware stack and is not a fixed constant.

Additionally, ~9+ super-steps are consumed at startup/shutdown by
`before_agent` and `after_agent` hooks from various middleware.

### Industry Comparison

| Product | Limit | Unit | Effective Rounds |
|---------|-------|------|------------------|
| Cursor | 25 (default), unlimited (long-running) | tool calls/message | 25+ |
| Claude Code | Unlimited (scripted) | — | — |
| OpenAI Agents SDK | 10 | turns (default) | 10 |
| **Stigmer (new)** | **6000** | **super-steps** | **varies by middleware** |

### Why 6000

- Generous enough for complex, long-running agent tasks
- Matches the pre-guardrails effective capacity (when middleware was dead code,
  1000 super-steps at ~3 steps/round ≈ 333 rounds; with active middleware,
  6000 super-steps provides comparable headroom)
- Sub-agent graphs use deepagents' `DEFAULT_RECURSION_LIMIT` (10,000)
  independently, so the main agent's limit doesn't constrain sub-agents
- Loop detection middleware is the primary behavioral safety — it catches
  repetitive patterns regardless of the recursion budget
- Execution budget middleware warns at ~80%, giving the model time to wrap up

## Configurability

`max_tool_rounds` is available in `ExecutionConfig` proto, allowing per-execution
overrides. The conversion formula is `recursion_limit = max_tool_rounds × 6`.
Valid range: 10–1000 rounds (60–6000 super-steps). The default of 6000 is
fixed in graphton; the orchestrator can override only when the user explicitly
requests it.

## Consequences

- All agent executions bounded at 6000 super-steps per user message
- Loop detection middleware (7 consecutive / 20 total) is the primary behavioral safety
- Execution budget warning fires at ~80% of the budget, giving the model time to wrap up
- The recursion limit is the hard ceiling for cost protection
- Value can be tuned based on observed usage patterns
