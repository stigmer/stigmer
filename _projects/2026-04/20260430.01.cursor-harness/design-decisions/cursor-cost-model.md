# Design Decision: Cursor Cost Model and Billing Integration

**Date**: 2026-04-30
**Task**: T06 -- Cost Model and Billing Integration
**Status**: DECIDED -- Per-message LlmCallMetrics with static Cursor pricing table

## Context

The cursor-runner (T03) built a `UsageTracker` that accumulated raw token counts
from Cursor SDK `TurnEndedUpdate` events into an aggregate `UsageMetrics` proto.
However, the aggregate was never persisted, and the approach did not match how the
rest of the system handles cost data.

The LangGraph (native) harness follows a per-message pattern:

1. Each LLM call produces an `LlmCallMetrics` proto with pricing stamped at call time
2. The metrics are attached to the corresponding `AgentMessage.llm_metrics` field
3. Server-side aggregation (`computeUsageFromMessages`) and the frontend
   `useSessionUsage` hook walk those per-message metrics to compute totals
4. No aggregate `UsageMetrics` is stored — it is always a computed projection

The cursor-runner must follow the same pattern for the entire downstream pipeline
(Go server, Java service, React hooks, usage reports) to work without modification.

## Research: Cursor SDK Usage Data

The Cursor SDK's `TurnEndedUpdate.usage` provides **token counts only**:

```typescript
interface TurnEndedUpdate {
  type: "turn-ended";
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}
```

No cost, no pricing rates, no `totalCents`. The `totalCents` field exists in
Cursor's Admin/Analytics API usage logs (dashboard data), but not in the real-time
SDK streaming events. `Cursor.models.list()` also returns no pricing information.

Cursor publishes per-model token rates at https://cursor.com/docs/models-and-pricing.
These rates are stable and publicly documented.

## Decision

### 1. Per-message LlmCallMetrics (not aggregate UsageMetrics)

Each Cursor `turn-ended` event produces an `LlmCallMetrics` proto that is stamped
onto the most recent `MESSAGE_AI` message's `llm_metrics` field. This matches the
Python agent-runner's `on_chat_model_end` pattern exactly.

The existing server aggregation (`usage_aggregation.go`, `UsageAggregationService.java`)
and frontend hooks (`useSessionUsage`, `UsageWidget`, `OrgUsagePanel`) work for
Cursor sessions with zero changes.

### 2. Static pricing table from Cursor's published rates

A TypeScript pricing registry (`model-pricing.ts`) in the cursor-runner maps Cursor
model IDs to per-million-token rates sourced from Cursor's pricing page. Cost is
computed at turn time, stamped on `LlmCallMetrics.estimated_cost_usd`.

This is the same approach as the Python `ModelRegistry` — pricing stamped at
execution time makes historical data self-contained.

### 3. Provider = "cursor"

`LlmCallMetrics.provider` and `ModelUsage.provider` are set to `"cursor"` for all
Cursor harness executions. Cursor is the provider from Stigmer's billing perspective.
This distinguishes Cursor usage from direct Anthropic/OpenAI usage in reports.

### 4. One LlmCallMetrics per Cursor turn

Each `turn-ended` event maps to one `LlmCallMetrics` entry. A Cursor "turn" may
internally involve multiple LLM calls, but the SDK only reports aggregate usage per
turn. This is the finest granularity available and is sufficient for cost tracking,
trend analysis, and the real-time `UsageWidget`.

## Alternatives Considered

### Aggregate UsageMetrics on status (rejected)

The original T03 approach. Would require the server aggregation to handle two
patterns (per-message + aggregate), the frontend to handle two patterns, and
creates a maintenance burden with behavioral divergence between harnesses.

### Post-execution Admin API reconciliation (rejected)

Query Cursor's Admin/Analytics API after execution to get `totalCents`. Adds
latency, requires Admin API access, and does not support real-time cost display
during streaming. Could be added later as a billing reconciliation step.

### Configurable pricing via env vars (rejected for MVP)

Pass `CURSOR_INPUT_PRICE_PER_MILLION` etc. at deployment time. Less granular
(one rate for all models) and harder to manage than a structured pricing table.
Could be added as an override mechanism if needed.

## Files Changed

| File | Change |
|------|--------|
| `cursor-runner/src/adapter/model-pricing.ts` | New: Cursor model pricing registry |
| `cursor-runner/src/adapter/usage-tracker.ts` | Rewritten: produces per-turn `LlmCallMetrics` with pricing |
| `cursor-runner/src/activity/execute-cursor.ts` | Modified: stamps `LlmCallMetrics` on `MESSAGE_AI` messages |
| `sdk/react/src/models/registry.ts` | Modified: added `"cursor"` provider and Cursor model entries |

## Files Verified (no changes needed)

| File | Verification |
|------|-------------|
| `stigmer-server/.../usage_aggregation.go` | Walks messages generically, no provider filtering |
| `stigmer-cloud/.../UsageAggregationService.java` | Same generic walk, no provider filtering |
| `sdk/react/src/session/useSessionUsage.ts` | Sums `llmMetrics` from all messages, provider-agnostic |
| `sdk/react/src/execution/UsageWidget.tsx` | Displays whatever model/provider strings come through |
| `sdk/react/src/usage/OrgUsagePanel.tsx` | Server-side aggregation, provider-agnostic |
