# Cursor Harness Cost Model and Billing Integration

**Date**: April 30, 2026

## Summary

Implemented unified cost tracking for the Cursor harness by aligning the cursor-runner's usage tracking with the established per-message `LlmCallMetrics` pattern. Created a Cursor model pricing registry sourced from Cursor's published API rates. The entire existing cost pipeline -- Go server aggregation, Java service aggregation, React usage hooks, and all usage UI components -- works for Cursor sessions with zero modifications.

## Problem Statement

The cursor-runner (built in T03) had a `UsageTracker` that accumulated token counts into an aggregate `UsageMetrics` proto. This approach had three critical issues:

### Pain Points

- The aggregate `toUsageMetrics()` method was never called in the execution flow -- all accumulated usage data was silently discarded
- The aggregate pattern did not match the system's actual architecture, which uses per-message `LlmCallMetrics` stamped on `AgentMessage.llm_metrics`
- No pricing data was computed -- Cursor executions showed $0 cost in all usage views
- The downstream pipeline (server aggregation, frontend hooks, usage reports) would have required dual-path changes to support the aggregate approach alongside the per-message approach

## Solution

Aligned the cursor-runner with the established per-message `LlmCallMetrics` pattern used by the Python agent-runner. Each Cursor SDK turn-ended event now produces a fully-priced `LlmCallMetrics` proto that is stamped onto the corresponding AI message, making the entire downstream pipeline work unchanged.

## Implementation Details

**New: Cursor model pricing registry** (`model-pricing.ts`)
- Static pricing table sourced from Cursor's published rates at cursor.com/docs/models-and-pricing
- Covers Cursor own models (Composer 2, 1.5, 1), Auto pool, and models available via Cursor's API pool
- `getCursorModelPricing()` with Auto-pool rates as safe default for unknown models
- `computeTurnCost()` using disjoint token buckets (input, output, cache write, cache read)

**Rewritten: UsageTracker** (`usage-tracker.ts`)
- `recordTurn()` returns a fully-populated `LlmCallMetrics` proto with pricing stamped at call time
- Replaced aggregate `UsageMetrics` construction with per-turn metrics production
- Cost logging for observability (same `[COST]` format as the Python agent-runner)

**Modified: ExecuteCursor activity** (`execute-cursor.ts`)
- `onDelta` callback collects `LlmCallMetrics` into a `pendingMetrics` queue
- Stream loop stamps each metric onto the most recent `MESSAGE_AI` message
- `stampMetricsOnLastAiMessage()` walks messages backward to find the unstamped target
- Post-stream drain handles the edge case where turn-ended fires with no subsequent event

**Modified: React model registry** (`registry.ts`)
- Added `"cursor"` to the `Provider` type union
- Added Cursor model entries (Composer 2, Composer 1.5, Auto)
- Added `"cursor"` to `DISABLED_PROVIDERS` (Cursor models only relevant for Cursor harness)

## Benefits

- **Unified cost visibility**: Cursor executions now show real-time cost, tokens, and model breakdown in UsageWidget, OrgUsagePanel, and all usage reports -- same experience as LangGraph executions
- **Zero downstream changes**: Go server, Java service, React hooks, and all UI work unchanged because the data follows the same per-message pattern
- **Pricing at execution time**: Historical data is self-contained (same design principle as the Python registry)
- **Foundation for billing**: Per-execution cost data enables platform-level billing where Stigmer adds margin on top of Cursor's rates

## Impact

- **Cursor-runner service**: 3 files changed, 1 file created (adapter layer)
- **React SDK**: 1 file modified (model registry)
- **Server/workflow**: Zero changes needed
- **Users**: Cursor harness sessions will display cost data identically to native harness sessions

## Related Work

- T03: Cursor Runner TypeScript Service (created the original UsageTracker)
- T05: CLI Daemon Multi-Worker Management and Cursor Proxy Architecture
- T09: Embedded Cursor Runner Packaging

---

**Status**: Production Ready
**Timeline**: ~1 hour (research + implementation)
