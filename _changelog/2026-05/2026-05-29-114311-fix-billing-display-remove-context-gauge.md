# Fix Billing Display and Remove Broken Context Gauge

**Date**: May 29, 2026

## Summary

Fixed a 6.3x cost overcharge in the Cursor harness billing display ($3.03 shown vs ~$0.48 actual), removed the broken context gauge that showed 426% utilization, and added an "Estimated" label to runner-reported costs. Also added comprehensive summarization integration tests for the native harness.

## Problem Statement

The agent execution billing panel showed incorrect data for Cursor harness sessions:

- **Context gauge showed 426%** (851K / 200K tokens) — `ContextTracker` treated Cursor SDK's `inputTokens` (a billing metric) as context window size, producing nonsensical values
- **Cost showed $3.03** when the true cost was ~$0.48 — `computeTurnCost` double-counted cache tokens because Anthropic's `inputTokens` INCLUDES `cacheReadTokens + cacheWriteTokens` as subsets, not additive buckets
- **Model pricing lookup failed** for `claude-haiku-4-5-20251001` (fell back to expensive Sonnet-level defaults) because date suffixes in model IDs didn't match registry entries
- **UsageWidget merged two independent data sources** (proxy billing + runner streaming) via `Math.max`, showing a total from one source with a model breakdown from another

### Pain Points

- Users saw a 6.3x inflated cost estimate for every Cursor session
- Context gauge was meaningless (>100% is physically impossible for a context window)
- Model breakdown ($0.0008 haiku + $0.00 sonnet) didn't sum to the displayed total ($3.03)
- Native harness context gauge showed nothing (never wired)

## Solution

Four-part fix addressing cost accuracy, display consistency, and misleading context data:

1. **Remove context gauge entirely** — neither harness produced correct data
2. **Fix cost double-counting** — subtract cached tokens from `inputTokens` before applying input rate
3. **Fix model ID normalization** — strip date suffixes before pricing lookup
4. **Single-source display** — never merge billing and streaming data in the same display; add "Estimated" badge for live runner data

## Implementation Details

### Context Gauge Removal (runner + UI)

- Deleted `context-tracker.ts` and all `ContextTracker` usage from `execute-cursor/index.ts`
- Removed `<ContextGauge>` from web `SessionPage.tsx`, desktop `SessionPage.tsx`, and Ink `SessionView.tsx`
- Removed `useContextWindow` hook calls and `summarizationEvents` prop from both SessionPages
- Component code kept (not deleted) for future native harness use when `contextInfo` is wired

### Cost Formula Fix

`computeTurnCost` now subtracts cached tokens:
```
regularInput = max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
cost = regularInput × inputRate + output × outputRate + cacheWrite × writeRate + cacheRead × readRate
```

Since the Java workflow (`BillingActivitiesImpl.recordCursorUsage`) creates billing records from `streamingUsage`, this fix corrects both the live estimate AND persisted billing records.

### Model ID Normalization

Added `normalizeModelId()` that strips date suffixes (`-20251001`, `-20250514`) from model IDs. Both `resolveModelId()` and `getCursorModelPricing()` try exact match first, then normalized — so `claude-haiku-4-5-20251001` correctly finds haiku pricing ($1/M input) instead of falling back to expensive defaults ($1.25/M input).

### Single-Source Usage Display

Replaced `mergeWithStreaming` (which used `Math.max` across sources) with clean single-source selection:
- If streaming has more tokens than billing (in-flight execution) → show streaming with `isEstimated: true`
- If billing covers everything → show billing with `isEstimated: false`
- Never mix sources in the same display

Added `isEstimated` field to `UseSessionUsageReturn`. React UsageWidget shows a small pill badge "Estimated"; Ink shows "(est.)" suffix.

### Summarization Integration Tests

New `test/integration/agent_execution_summarization_test.go` with two tests:
- `ContextRetention`: 3-turn conversation proving the agent retains facts from early turns
- `TokenGrowth`: 4-turn conversation verifying input token growth with summarization detection

### Integration Test Update

Updated `TestAgentExecution_CursorUsage_FullPipeline` to assert `contextInfo` is nil (no longer emitted).

## Benefits

- Cursor session costs now accurate (~$0.48 instead of $3.03 for the same workload)
- No more confusing 426% context gauge
- "Estimated" badge sets correct user expectation for live costs
- Model breakdown always matches the total (single source)
- Summarization behavior now has integration test coverage

## Impact

- **Session page users**: See correct cost, no misleading context gauge, clear "Estimated" label during execution
- **Org billing**: Persisted billing records corrected (both live estimate and Java-written records use the fixed formula)
- **CLI users**: Ink UsageWidget shows "(est.)" for live costs
- **Both editions**: All changes apply to OSS and Cloud

## Related Work

- Fix Cursor Harness Billing Records + Live Usage (May 24) — the Java workflow that sources billing from `streaming_usage`
- Phase 3: Chat Summarization Visibility (May 16) — the `SummarizationCard` UI that summarization events feed into
- Cursor Experience Parity project — the parent initiative this work belongs to

---

**Status**: Production Ready
**Timeline**: Single session
