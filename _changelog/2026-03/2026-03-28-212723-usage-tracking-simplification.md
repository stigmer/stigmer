# Usage Tracking Simplification — HITL-Parallel Architecture

**Date**: March 28, 2026

## Summary

Eliminated the "cost resets to zero" bug by restructuring usage tracking around a single source of truth: per-message `LlmCallMetrics`. Removed the ephemeral in-memory `UsageTracker` from the persistence path, deleted the aggregate `status.usage` field from both `AgentExecutionStatus` and `SubAgentExecution` protos, and replaced the single-execution cost widget with a session-level `UsageWidget` that aggregates cost across all executions — matching the pattern established by `ArtifactsWidget` and `WriteBacksWidget`.

## Problem Statement

The usage widget in the session sidebar would display an accurate cost (e.g., $3.48) during initial streaming, then reset to a lower number ($0.05) when execution resumed after an approval wait or any Temporal activity restart.

### Pain Points

- `UsageTracker` was created fresh on every activity invocation without hydration from persisted state
- `CopyFrom(build_usage_metrics())` performed a full replace, overwriting the persisted aggregate with a fresh (incomplete) one
- The cost widget was scoped to a single execution, not the session — users saw it "reset" on follow-up messages
- Parallel state (in-memory tracker vs. persisted proto) is the same anti-pattern that caused the HITL approval bugs

## Solution

Applied the same "single source of truth + computed projection" architecture that resolved the HITL approval flow:

1. **Per-message `LlmCallMetrics`** is stamped on every AI message and persisted with the message — it survives resumption by design
2. **No aggregate `status.usage` field** — removed from both `AgentExecutionStatus` and `SubAgentExecution` protos entirely
3. **Frontend computes session-level usage** from messages it already has (no extra RPC)
4. **Server-side report RPCs** (`getSessionUsageReport`, etc.) compute on-demand from per-message data

## Implementation Details

### Proto Changes (4 files)

- **`usage.proto`**: Added `total_tokens` (field 11) to `LlmCallMetrics`
- **`message.proto`**: Replaced 7 flat cost fields (7-13) with nested `LlmCallMetrics llm_metrics = 7`; added `usage.proto` import
- **`api.proto`**: Removed `UsageMetrics usage = 11` from `AgentExecutionStatus`; removed `usage.proto` import
- **`subagent.proto`**: Removed `UsageMetrics usage = 12` from `SubAgentExecution`; removed `usage.proto` import

### Python Agent-Runner (7 files)

- **`status_builder.py`**: Replaced flat field stamps with `ai_message.llm_metrics.CopyFrom(call_metrics)`; removed all `CopyFrom` to `.usage`, `finalize_usage()`, `usage_tracker` property, `record_approval_wait`, `record_tool_duration`, `record_summarization` calls
- **`usage_tracker.py`**: Simplified to logging-only — kept `record_llm_call`, `_compute_call_cost`, `_resolve_metadata`, `get_estimated_cost`, `get_llm_call_count`; removed `build_usage_metrics`, `_ModelAccumulator`, all duration/truncation/summarization recording
- **`execute_graphton.py`**: Removed `finalize_usage()` call and `_on_tool_truncation` callback
- **`streaming.py`**, **`post_stream.py`**: Removed `finalize_usage()` calls
- **`temporal_helpers.py`**: Removed `slim.usage.CopyFrom(status.usage)`
- **Tests**: Removed `TestUsageMetrics`, `TestFinalizeUsage`, all `.usage.*` assertions; updated AI message assertions to use `.llm_metrics.*`

### Java Server (3 files)

- **`AgentExecutionUpdateStatusHandler.java`**: Removed usage merge block and `has_usage` from debug logs
- **`UpdateExecutionStatusActivityImpl.java`**: Same pattern — removed usage merge and log references
- **`UsageAggregationService.java`**: Rewrote all methods to compute from per-message `llm_metrics` via `collectLlmMetrics()` instead of the removed `status.usage`

### Go Server + CLI (6 files)

- **`update_status.go`**, **`update_status_impl.go`**: Removed usage merge blocks and log references
- **`usage_aggregation.go`**: Rewrote to compute from per-message `llm_metrics` via `computeUsageFromMessages()`
- **`usage_format.go`**: Added `computeExecutionUsage()` helper for CLI display
- **`run_display_summary.go`**, **`resume_session.go`**: Updated to use `computeExecutionUsage()` instead of `Status.GetUsage()`

### Frontend (8 files)

- **Created** `useSessionUsage` hook — `useMemo`-based session-level aggregation from per-message `llm_metrics`
- **Created** `UsageWidget` component — session-scoped, returns `null` when empty, follows `ArtifactsWidget`/`WriteBacksWidget` pattern
- **Deleted** `useExecutionUsage.ts`, `ExecutionCostSummary.tsx`, and their test files
- **Updated** barrel exports in `execution/index.ts`, `session/index.ts`, root `index.ts`
- **Updated** `SessionPage.tsx` to use `UsageWidget` with session-level execution list

## Benefits

- **Bug fixed**: Cost never resets — per-message data survives any resumption
- **Session-level totals**: Users see cumulative cost across all executions in a conversation
- **Simpler architecture**: One source of truth (per-message `llm_metrics`), two consumers (frontend widget, server reports)
- **Less code**: Net -3,750 lines deleted across the codebase
- **Cleaner API**: Platform builders see `AgentMessage.llm_metrics` (typed `LlmCallMetrics`) instead of 7 flat fields
- **No hydration hacks**: The fix eliminates the architectural debt, not the symptom

## Impact

- **All consumers**: Proto breaking change — `status.usage` removed from `AgentExecutionStatus` and `SubAgentExecution`
- **Agent-runner**: No longer writes aggregate usage; simplified `UsageTracker`
- **Java + Go servers**: No longer merge usage on status update; report RPCs compute on-demand
- **CLI**: Updated to derive cost/model from per-message data
- **React SDK**: `ExecutionCostSummary` → `UsageWidget`; `useExecutionUsage` → `useSessionUsage`
- **Console**: Sidebar cost widget now session-scoped

## Related Work

- [HITL Approval Flow Cleanup](2026-03/20260327.01.hitl-approval-cleanup) — same "single source of truth" pattern applied to usage
- [Sub-Agent UI Visibility Fix](2026-03/2026-03-28-191432-fix-sub-agent-ui-visibility.md) — recent work on sub-agent message handling

---

**Status**: ✅ Production Ready
**Timeline**: ~4 hours
