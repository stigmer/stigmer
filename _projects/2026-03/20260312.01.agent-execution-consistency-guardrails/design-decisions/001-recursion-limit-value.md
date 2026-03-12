# Design Decision 001: Recursion Limit Value

**Date**: 2026-03-12
**Status**: Revised
**Decided by**: User + AI (collaborative)

## Context

The orchestrator (`execute_graphton.py`) was overriding graphton's default `recursion_limit` of 100 with 1000 in two places. We needed to decide what the correct default should be.

### Revision (2026-03-12, Session 7)

The original decision assumed ~2 super-steps per model-tool round. Empirical
testing revealed the actual ratio is **~6 super-steps per round** due to
middleware graph nodes (before_model, model, 3× after_model, tools). This
meant `recursion_limit=100` only allowed ~16 model rounds — far fewer than
the intended ~50.

The default has been set to **1000 super-steps (~166 model-tool rounds)** —
matching DeepAgents' own default. This is deliberately generous; loop
detection middleware and execution budget warnings are now the primary
behavioral safety mechanisms. The recursion limit serves as a hard cost
ceiling. The value can be tuned down based on observed usage patterns.

## Decision

**Use graphton's default of 1000 super-steps (~166 model+tool rounds).** Do not override from the orchestrator.

## Rationale

### Super-step Ratio

Each model-tool round consumes ~6 LangGraph super-steps:

| Node | Count per round | Source |
|------|----------------|--------|
| `before_model` (SummarizationMiddleware) | 1 | middleware hook |
| `model` | 1 | core agent |
| `after_model` (ContextSummarizationMiddleware) | 1 | middleware hook |
| `after_model` (LoopDetectionMiddleware) | 1 | middleware hook |
| `after_model` (ExecutionBudgetMiddleware) | 1 | middleware hook |
| `tools` | 1 | core agent |
| **Total** | **~6** | |

Additionally, ~9 super-steps are consumed at startup/shutdown by `before_agent`
and `after_agent` hooks from various middleware, but these are one-time costs.

### Industry Comparison

| Product | Limit | Unit | Effective Rounds |
|---------|-------|------|------------------|
| Cursor | 25 | tool calls/message | 25 |
| Claude Code | Unlimited (scripted) | — | — |
| OpenAI Agents SDK | 10 | turns (default) | 10 |
| **Stigmer (new)** | **1000** | **super-steps** | **~166** |

### Why 1000

- ~166 model-tool rounds — matches DeepAgents' default of 1000 super-steps
- Well within Claude Code's recommended range for complex tasks (40-200+ turns)
- Sub-agent graphs use deepagents' `DEFAULT_RECURSION_LIMIT` (10,000) independently, so the main agent's limit doesn't constrain sub-agents
- Graphton's loop detection middleware provides additional behavioral protection

### Why NOT 6000+ (1000+ rounds)

- 6000 super-steps ≈ ~1000 model-tool rounds (~25 min) — beyond practical single-message tasks
- Even with loop detection, varied unproductive work could burn significant LLM cost
- Can be revisited once usage patterns are observed

## Configurability

`max_tool_rounds` is available in `ExecutionConfig` proto, allowing per-execution
overrides. The conversion formula is `recursion_limit = max_tool_rounds × 6`.
The default of 1000 is fixed in graphton; the orchestrator can override only
when the user explicitly requests it.

## Consequences

- All agent executions bounded at ~166 model-tool rounds per user message (~4 min)
- Loop detection middleware (7 consecutive / 20 total) is the primary behavioral safety
- Execution budget warning fires at ~80% (~133 rounds), giving the model time to wrap up
- The recursion limit is the hard ceiling for cost protection
- Value can be tuned down based on observed usage patterns
