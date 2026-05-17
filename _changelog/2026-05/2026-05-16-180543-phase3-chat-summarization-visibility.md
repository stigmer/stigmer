# Phase 3: Chat Summarization Visibility for Both Harnesses

**Date**: May 16, 2026

## Summary

Added context window tracking and inline summarization visibility for Cursor harness sessions, and wired inline "Context compacted" timeline cards into the message thread for both harnesses. Previously, Cursor sessions showed no context health or summarization info at all, and native harness summarization events were only visible in a sidebar widget.

## Problem Statement

### Pain Points

- Cursor harness sessions showed nothing about context utilization or summarization — `ContextGauge` returned null, `SummarizationBadge` had no events to display
- When the native harness triggered summarization mid-conversation, the user only saw a sidebar counter badge — not an inline notification where their attention actually is (the message thread)
- No parity between harnesses: native sessions had full context visibility, Cursor sessions had zero

## Solution

Two complementary changes that give both harnesses visible summarization:

1. **Cursor harness approximate ContextInfo** — A new `ContextTracker` in cursor-runner infers context state from per-turn `inputTokens`. Detects Cursor's internal summarization when input tokens drop >30% between consecutive turns. Emits approximate `ContextInfo` proto on every status heartbeat.

2. **Inline SummarizationCard in MessageThread** — A new `"context-compacted"` thread item type interleaved chronologically among messages. Shows token reduction, compression ratio, and (for native) model/duration/cost. Distinguishes native ("Context compacted") from Cursor ("Detected context compaction").

## Implementation Details

### Cursor-Runner: ContextTracker (`context-tracker.ts`)

- Tracks `inputTokens` from `TurnEndedUpdate.usage` on each turn
- Maintains a static lookup table of well-known model context windows (Claude, GPT, Gemini, O-series)
- Detects summarization: if `inputTokens` drops >30% from previous turn, records a `SummarizationEvent` with `SUMMARIZATION_SOURCE_UNSPECIFIED`
- `snapshot()` produces a `ContextInfo` proto with approximate utilization and detected events
- Thresholds set to 0 (unknown for Cursor), `summarizationEnabled: true`

### Execute-Cursor Integration

- `ContextTracker` initialized alongside `UsageAccumulator` after model resolution
- Fed `inputTokens` in the `turn-ended` `onDelta` handler
- `status.contextInfo` emitted on every heartbeat and at finalization

### React SDK: SummarizationCard

- Compact inline card with compression icon, before/after tokens, ratio, time/model/cost
- `isInferred` flag (no model = Cursor) switches label to "Detected context compaction"
- `role="status"` accessibility, `--stgm-*` design tokens

### MessageThread: Event Interleaving

- New `"context-compacted"` variant in the `ThreadItem` discriminated union
- `buildThreadItems` accepts optional `summarizationEvents` and interleaves them by timestamp among messages using a cursor-based flush
- `ThreadItemRenderer` renders `SummarizationCard` for the new variant
- `VirtualizedThread` inherits support automatically via shared `ThreadItemRenderer`

### Client App Wiring (Web + Desktop)

- Both `SessionPage.tsx` files call `useContextWindow(flow.displayExecution)` and pass `summarizationEvents` to `MessageThread`

## Benefits

- Cursor sessions now show context utilization in `ContextGauge` and detected compaction events in `SummarizationBadge`
- Both harnesses show inline "Context compacted" cards in the message timeline
- Users can see when and how much context was compacted without checking the sidebar
- Foundation for Phase 3b (manual trigger, full transcript access) when needed

## Impact

- **React SDK**: New `SummarizationCard` component + `MessageThread` prop extension (backward compatible — `summarizationEvents` is optional)
- **Cursor-runner**: New `context-tracker.ts` adapter + 3 insertion points in `execute-cursor.ts`
- **Client apps**: 2 SessionPage files updated (web + desktop parity)
- No proto changes needed — leverages existing `ContextInfo` and `SummarizationEvent` from Phase 2

## Related Work

- Phase 1 (Usage MVP): `UsageAccumulator` in cursor-runner
- Phase 2 (Context Window Visibility): `ContextGauge`, `SummarizationBadge`, `useContextWindow` hook
- Graphton summarization middleware (external package) drives native harness events

---

**Status**: Production Ready
**Project**: 20260513.01.cursor-experience-parity (Phase 3a)
