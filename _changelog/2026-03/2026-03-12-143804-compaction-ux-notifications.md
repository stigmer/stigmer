# Context Compaction UX Notifications

**Date**: March 12, 2026

## Summary

Added end-to-end user-visible notifications when the agent's context window is compacted (summarized). The backend now tags each compaction event with its trigger source and streams it immediately to the CLI, which renders a dimmed system line showing token reduction metrics. This closes the feedback gap where context compaction happened silently.

## Problem Statement

When context compaction (summarization) fires — either at graph-start or mid-execution — the user has no visibility into it. The agent's context shrinks from 185K to 80K tokens and the user sees nothing. This creates confusion when the agent loses context or when execution pauses briefly during compaction.

### Pain Points

- Users unaware that compaction occurred, leading to surprise when the agent "forgets" recent context
- No way to distinguish graph-start compaction (proactive) from mid-execution compaction (reactive to token pressure)
- `StatusBuilder` accumulated `SummarizationEvent`s in an internal list but never synced them to the gRPC stream for immediate delivery
- CLI had no event type or rendering path for compaction notifications

## Solution

Full-stack notification pipeline: Proto enum for source tagging, backend immediate-streaming via `_sync_context_info()` + `force_next_update`, CLI event detection with count-based dedup, and both inline (dimmed system line) and JSON output rendering.

## Implementation Details

### Proto Layer (2 files)
- New `SummarizationSource` enum in `enum.proto` with values `graph_start` (triggered in `abefore_agent`) and `mid_execution` (triggered in `awrap_model_call`)
- Added `SummarizationSource source` field to `SummarizationEvent` message in `api.proto`
- Regenerated Go and Python stubs (6 files)

### Backend — Graphton Library (3 files)
- Added `source: str` field to `SummarizationEventData` dataclass
- Defined `SOURCE_GRAPH_START` and `SOURCE_MID_EXECUTION` string constants in `summarization_callback.py` — these mirror proto enum names but keep graphton proto-free
- `SummarizationMiddleware` sets source using these constants in both trigger paths

### Backend — Agent Runner (2 files)
- `StatusBuilder.on_summarization_complete()` refactored: events now append directly to `_context_info.summarization_events` (single source of truth, eliminated internal `_summarization_events` list)
- New `_sync_context_info()` copies context info to `current_status` for incremental gRPC delivery
- `force_next_update = True` after compaction ensures the CLI receives the event on the next poll cycle
- Proto enum mapping via `SummarizationSource.Value(event.source)` — no manual dict, falls back to `UNSPECIFIED` on unknown values

### CLI — Go (8 files)
- `ContextCompactedEvent` struct in `executiontui/events.go`
- Count-based dedup in `streamToEvents` (Step 1f): `seenSummarizationCount` tracks processed events, emits only new ones
- `mapSummarizationSource()` converter from proto enum to string
- `renderContextCompacted()`: dimmed system line committed to scrollback — "Context compacted: 185K → 80K tokens (57% reduction)"
- JSON mode emits `context_compacted` event with full payload

### Tests (4 files)
- 4 new Python tests: source-to-proto mapping, unknown-source fallback, immediate sync to `current_status`, `force_next_update` flag
- 3 new Go tests: `mapSummarizationSource` enum coverage, inline rendering output, JSON payload structure
- All existing tests updated for new `source` field

## Benefits

- Users see exactly when and why context was compacted
- Token reduction metrics (before/after/percentage) provide actionable insight
- Immediate delivery ensures notifications appear at the moment compaction happens, not on the next scheduled poll
- Dimmed system line is non-intrusive but permanently visible in scrollback history
- JSON mode enables programmatic consumption for monitoring/alerting

## Impact

- **End users**: Gain visibility into a previously invisible system behavior
- **Debugging**: Compaction events in scrollback history help correlate context loss with agent behavior changes
- **Monitoring**: JSON output enables dashboards tracking compaction frequency and compression ratios
- **Architecture**: Established the pattern for `_sync_context_info()` + `force_next_update` for any future context-level events that need immediate CLI delivery

## Related Work

- PR2 (Session 3): Mid-execution context compaction — the backend compaction logic that this work now surfaces to users
- D1+D2 (Session 6): Execution budget middleware — another resource-awareness feature using similar notification patterns
- Project `20260312.01.agent-execution-consistency-guardrails` — parent project addressing 5 architectural gaps

---

**Status**: Production Ready
**Scope**: 22 files changed, ~544 insertions
