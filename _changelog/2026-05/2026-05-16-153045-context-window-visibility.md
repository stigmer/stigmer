# Context Window Visibility — Phase 2 of Cursor Experience Parity

**Date**: May 16, 2026

## Summary

Added real-time context window visibility to the React SDK and Console. Users can now see how much of the model's context window is being consumed during agent execution, when automatic summarization occurs, and the compression achieved. Also fixed a critical data flow gap where `runner_usage` was silently dropped by both the Go and Java update status handlers, preventing Phase 1's cursor usage data from ever reaching the frontend.

## Problem Statement

After Phase 1 added the `UsageAccumulator` to capture Cursor SDK token usage, the data was being written to `AgentExecutionStatus.runner_usage` but never persisted — both server handlers dropped it during the status merge step. Additionally, the platform had no frontend visibility into context window utilization despite the Python agent-runner already populating `ContextInfo` with token counts, summarization thresholds, and summarization event history.

### Pain Points

- `runner_usage` field defined in proto and populated by cursor-runner, but silently dropped by both Go OSS and Java Cloud `UpdateStatus` handlers
- `useSessionUsage` had a runner-usage fallback path that could never activate because the data never reached the frontend
- `ContextInfo` (current_token_count, context_window_limit, utilization_percent, summarization_events) flowed from Python agent-runner to the server but had no React hooks or components to surface it
- No way for users to see how close they are to the context window limit during long-running sessions

## Solution

Three-layer implementation following the SDK architecture standards (DD-001 SDK-first, DD-003 headless-first, DD-016 client-app parity):

1. **Backend fix**: Added `runner_usage` and `runner_id` merge to both Go and Java status handlers
2. **React SDK hook**: `useContextWindow` extracts `ContextInfo` from execution status and derives health state
3. **React SDK components**: `ContextGauge` (progress bar with threshold markers) and `SummarizationBadge` (collapsible event history)
4. **Console wiring**: Both web and desktop SessionPages updated identically

## Implementation Details

### runner_usage Merge Fix

Both `BuildNewStateWithStatusStep` implementations (Go in `update_status.go`, Java in `AgentExecutionUpdateStatusHandler.java`) now merge `runner_usage` and `runner_id` from incoming status updates, following the same pattern as the existing `context_info` merge. Debug logging updated to include `has_runner_usage`.

### useContextWindow Hook

Headless data hook that normalizes `ContextInfo` proto fields into a rendering-friendly interface. Derives `health` (healthy/warning/critical) from utilization thresholds documented in the proto (0-70% green, 70-90% yellow, 90%+ red). Computes `isNearThreshold` when utilization is within 5% of the summarization trigger point. Returns a stable empty state for Cursor harness executions where `context_info` is absent.

### ContextGauge Component

Two rendering modes:
- **Full mode**: Header with percentage, progress bar with summarization threshold marker, token count labels (compact format: 42K / 200K), health dot with status text, summarization count and latest event summary
- **Compact mode**: Thin bar with percentage for tight layouts

Uses `--stgm-success`, `--stgm-warning`, `--stgm-destructive` tokens for health-state colors. Accessible via `role="meter"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext`.

### SummarizationBadge Component

Collapsible history of summarization events. Collapsed: icon + count ("2 summarizations"). Expanded: chronological event cards showing tokens before/after, compression ratio, duration, model used, and cost. Keyboard-accessible toggle with `aria-expanded`.

### Console Wiring (DD-016)

Both `client-apps/web` and `client-apps/desktop` SessionPages import `ContextGauge` and render it above `UsageWidget` in the execution details sidebar. The gauge renders only when `context_info` is available (native harness), keeping the sidebar clean for Cursor harness sessions.

## Benefits

- Users can see context utilization in real-time during execution streaming
- Summarization events are surfaced with compression ratios and cost, enabling users to understand context management behavior
- Platform builders embedding `<ContextGauge>` or using `useContextWindow()` get context visibility in their own products
- The `runner_usage` merge fix unblocks Phase 1's cursor usage display — `useSessionUsage` fallback path now works

## Impact

- **React SDK**: 3 new exports (`useContextWindow`, `ContextGauge`, `SummarizationBadge`) + 5 new type exports
- **Console (web + desktop)**: Context gauge visible in session sidebar during native harness executions
- **Backend (Go + Java)**: `runner_usage` and `runner_id` now persisted and streamed to subscribers
- **Tests**: 9 new unit tests for `useContextWindow` hook covering edge cases, health derivation, and reference stability

## Related Work

- Phase 1 (Session 3, May 13): Usage MVP — `UsageAccumulator`, `RecordLlmCallUsageHandler` harness support
- Proto foundation: `context.proto` (ContextInfo, SummarizationEvent), `usage.proto` (RunnerUsageSummary)
- Python agent-runner: `handlers/context.py` (initialize_context_info, on_summarization_complete, on_token_count_updated)

---

**Status**: In Progress (implemented, needs commit and deployment verification)
**Timeline**: Single session implementation
