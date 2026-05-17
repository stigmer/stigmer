# Capture SDK-Resolved Model in Cursor Billing Records

**Date**: May 17, 2026

## Summary

The Cursor runner now captures the actual model used by the Cursor SDK (`RunResult.model?.id`) and sends it as the `resolvedModel` in billing records, while the user-configured model becomes the `requestedModel`. The billing handler gains a pricing fallback: if the SDK-reported model isn't in the registry, it retries with the requested model to prevent billing gaps.

## Problem Statement

When the cursor-runner emitted billing records via `recordLlmCallUsage`, it sent the **same value** for both `resolvedModel` and `requestedModel` — the config model from `resolveModelId()`. This created three issues:

### Pain Points

- No visibility into what model Cursor actually used (important for "default"/auto-select where Cursor chooses the model)
- Pricing always based on the requested model, not what was resolved — potential inaccuracy when models diverge
- No observability into model routing divergence between what users request and what they get

## Solution

Split the model fields to carry their correct semantic values: `requestedModel` = what the user/config asked for, `resolvedModel` = what the Cursor SDK actually used. Added a server-side pricing fallback so billing never breaks when the SDK returns an unrecognized model slug.

## Implementation Details

### Cursor Runner (`execute-cursor.ts`)

- After `run.wait()`, extracts `result.model?.id` as the SDK-resolved model
- Logs model divergence when SDK reports a different model than configured
- Extracted `buildTurnBillingInput()` as an exported pure function for testability
- Platform-stop and HITL paths fall back to config model (no `RunResult` available yet)

### Billing Handler (`RecordLlmCallUsageHandler.java`)

- Pricing lookup first tries `resolvedModel`, then falls back to `requestedModel` when different
- Fallback-priced records are marked `COST_CALCULATION_STATUS_ESTIMATED` (no proto changes)
- Enhanced warning logs include both model names for easier debugging

### Tests

- 8 new cursor-runner unit tests covering model propagation, fallback behavior, and field correctness
- 7 new Java handler tests covering pricing fallback, guard conditions, and record field preservation

## Benefits

- Accurate model attribution in billing records — know exactly what model was used
- Zero-regression fallback — if SDK returns an unknown model, billing falls back to the same behavior as before
- Observability into Cursor's model routing — production data will show whether requested and resolved models diverge
- Clean test coverage for billing record construction and pricing fallback logic

## Impact

- **Billing accuracy**: Records now distinguish between requested and resolved models, enabling future pricing improvements when registry is updated with Cursor-internal model slugs
- **Observability**: Model divergence logging in runner + `ESTIMATED` status in billing records create an audit trail
- **Cross-repo**: Changes span `stigmer` (cursor-runner) and `stigmer-cloud` (billing handler)

## Related Work

- Part of Harness Cost Economics project (WI-2): `_projects/2026-05/20260516.01.harness-cost-economics/`
- Builds on WI-1 (Prompt Caching) and WI-4 (Context Trimming) completed in sessions 01 and 02
- WI-3 (Documentation) and WI-5 (Benchmark) remain

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
