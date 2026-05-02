# Cursor Runner Delta Enrichment: Real-Time Shell Output and Tool Timing

**Date**: May 2, 2026

## Summary

Implemented the `DeltaEnricher` component for the cursor-runner service, processing the Cursor SDK's `onDelta` (InteractionUpdate) channel to provide real-time shell output streaming, precise tool call timing, and intelligent persist-rate-limiting. This closes the "deferred work" item from the event visibility changelog and delivers the first concrete capability that the stream channel alone cannot provide: live shell command output.

## Problem Statement

The cursor-runner's `onDelta` callback was only used for billing metrics (`turn-ended` usage). The Cursor SDK emits 436 delta events per execution — 77% richer than the 245 stream events — including `shell-output-delta`, `tool-call-started`, `tool-call-completed`, and `thinking-completed` events that the stream channel does not provide at all.

### Pain Points

- **Invisible shell execution**: When a Cursor agent runs shell commands (builds, tests, installs), users see nothing until the command completes. Long-running commands appear indistinguishable from hangs.
- **Imprecise timing**: Tool call durations were approximated from message timestamps rather than derived from SDK-provided lifecycle events.
- **Wasted persist opportunities**: The cursor-runner persisted on a fixed event-count cadence (every 20 stream events), regardless of whether meaningful UI-visible state had changed.

## Solution

Created a `DeltaEnricher` class that processes `InteractionUpdate` events as a complementary enrichment signal alongside the existing `MessageAccumulator`. The stream remains the source of truth for message construction; the enricher provides real-time liveness data that the stream cannot.

## Implementation Details

### DeltaEnricher (`delta-enricher.ts`)

- **Shell output streaming**: Buffers `shell-output-delta` chunks per `callId`, applies accumulated content to the matching `ToolCall.result` with `is_streaming=true` and `streaming_source=OUTPUT`. Falls back to the most recently started shell tool call when the event payload lacks an explicit `callId`.
- **Tool call timing**: Records precise `startedAt` and `completedAt` timestamps from `tool-call-started` / `tool-call-completed` deltas. Does not overwrite timestamps already set by the stream (stream wins on conflict).
- **Thinking duration**: Captures `thinkingDurationMs` from `thinking-completed` and logs it for observability. No proto field exists for this; logged as a future enhancement candidate.
- **Dirty-flag persist logic**: Sets `isDirty` when shell output arrives. The getter debounces at 500ms (matching the Python agent-runner's `update_scheduler` interval) to prevent backend write storms during rapid output bursts.
- **Finalization**: Clears `is_streaming` and resets `streaming_source` on all tool calls when the stream loop ends.

### Execute-Cursor Integration (`execute-cursor.ts`)

- `deltaEnricher.processDelta(update)` added to the existing `onDelta` callback (alongside billing logic)
- `deltaEnricher.applyEnrichments(status.messages)` called after each stream event in the loop
- Persist condition expanded: `eventCount % 20 === 0 || deltaEnricher.isDirty`
- `deltaEnricher.markPersisted()` called after each persist to reset debounce
- `deltaEnricher.finalize(status.messages)` called alongside `accumulator.finalize()`

### Design Decisions

- **No proto changes**: Uses existing `ToolCall.is_streaming`, `ToolCall.streaming_source` (OUTPUT), and `ToolCall.result` for partial content — all already defined and supported by downstream UI.
- **Buffer-then-apply pattern**: Delta events are buffered internally; the stream loop drains them. This respects the single-threaded Node.js model — no locks, no races.
- **Shell callId fallback**: Tracks `lastShellCallId` from `tool-call-started` events to handle `shell-output-delta` payloads that omit explicit call identification.
- **No text-delta processing**: The stream channel already provides token-level content via `MessageAccumulator`. Adding redundant `text-delta` processing would add complexity without UX benefit.

## Benefits

- **Live shell output**: Users can watch command output stream in real time while Cursor agents execute builds, tests, and deployments. No more waiting for completion to see output.
- **Precise tool timing**: `startedAt` / `completedAt` on tool calls now reflect SDK-provided lifecycle events rather than message-timestamp approximations.
- **Intelligent persistence**: The dirty-flag mechanism triggers additional persists only when shell output arrives, with 500ms debounce. Normal stream-event-based persistence continues unchanged.
- **Zero downstream changes**: The existing CLI and web UI already render `ToolCall.is_streaming` + `streaming_source=OUTPUT` — they just never received this data from Cursor executions.

## Impact

- **cursor-runner**: `delta-enricher.ts` (new, 282 lines), `execute-cursor.ts` (8 lines added), `delta-enricher.test.ts` (new, 18 tests)
- **Tests**: 172 total tests pass (18 new + 154 existing), typecheck clean, no lint errors
- **Users**: Cursor harness sessions now show live shell output and precise tool timing in both the web console and CLI

## Related Work

- Event Visibility changelog (2026-05-02): Fixed three layers of data loss; deferred delta enrichment to this session
- Python agent-runner `update_scheduler.py`: The 500ms debounce interval aligns with this proven pattern
- Native harness tool streaming: Uses `ToolStreamDeltaEvent` (different mechanism, same UX outcome)

---

**Status**: Production Ready
**Timeline**: Single session
