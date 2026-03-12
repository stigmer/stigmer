# Design Decision 001: Recursion Limit Value

**Date**: 2026-03-12
**Status**: Accepted
**Decided by**: User + AI (collaborative)

## Context

The orchestrator (`execute_graphton.py`) was overriding graphton's default `recursion_limit` of 100 with 1000 in two places. We needed to decide what the correct default should be.

## Decision

**Use graphton's default of 100 super-steps (~50 model+tool rounds).** Do not override from the orchestrator.

## Rationale

### Industry Comparison

| Product | Limit | Unit | Effective Rounds |
|---------|-------|------|------------------|
| Cursor | 25 | tool calls/message | 25 |
| Claude Code | Unlimited (scripted) | — | — |
| OpenAI Agents SDK | 10 | turns (default) | 10 |
| **Stigmer (new)** | **100** | **super-steps** | **~50** |

### Why 100

- 2x Cursor's 25-tool-call limit — generous enough for complex sub-agent workflows
- Well within Claude Code's recommended range for complex tasks (40-200+ turns)
- Sub-agent graphs use deepagents' `DEFAULT_RECURSION_LIMIT` (10,000) independently, so the main agent's limit doesn't constrain sub-agents
- Graphton's loop detection middleware provides additional behavioral protection

### Why NOT 1000

- 1000 super-steps ≈ 500 tool-call rounds — far beyond any practical single-message task
- Enables runaway self-improvement loops (observed in production)
- Combined with broken loop detection, creates unbounded autonomous execution

## Configurability

Deferred to a follow-up PR. The intent is to add `max_tool_calls` to `ExecutionConfig` proto, allowing per-execution overrides. The default of 100 is fixed in graphton; the orchestrator can override only when the user explicitly requests it.

## Consequences

- All agent executions bounded at ~50 tool-call rounds per user message
- Agents that legitimately need more must have the user send another message to continue (Cursor's "Continue" pattern)
- Production agents that previously relied on >100 super-steps will hit the limit — this is intentional and observable via the new `GraphRecursionError` handler
