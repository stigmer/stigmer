# Unify Session Resume to Single Event-Driven Rendering Path

**Date**: February 24, 2026

## Summary

Eliminated the separate replay rendering path for resumed sessions, replacing it with the same event-driven pipeline that powers live execution. This ensures noise suppression, lifecycle badges, and duplicate filtering apply automatically to both live and resumed sessions — zero rendering drift, zero code duplication.

## Problem Statement

Two independent rendering paths existed for the same execution data:

1. **Live path** (`streamToEvents`) — gRPC stream updates diffed into typed events, processed by `executiontui.New()` with noise filtering, lifecycle badges, and duplicate suppression.
2. **Replay path** (`BuildReplayBlocks`) — stored execution data converted directly to content blocks via a separate implementation in `replay.go`, lacking all of the above.

### Pain Points

- The replay path did not suppress "Approval received" system messages, causing visual noise when resuming sessions
- Lifecycle badges (⏸ → ⏳ → ✓) on tool calls were absent in replay mode
- `isTrackedToolMessage` duplicate suppression was missing, potentially creating redundant tool result blocks
- Every rendering improvement to the live path required manual duplication into the replay path — an inherently divergent maintenance burden

## Solution

Convert stored execution snapshots into the same event stream that the live TUI consumes. A new `snapshotToEvents` goroutine walks the message array chronologically, emitting tool block events inline after the AI messages that reference them — preserving the natural conversation interleaving that the live path produces. The TUI processes these events through `executiontui.New()` — the single, canonical rendering path.

The same building blocks power both paths: `emitCompleteMessage` handles message dispatch and noise filtering, `isTrackedToolMessage` suppresses duplicate `MESSAGE_TOOL` entries, and `convertToolCall` / `mapToolCallStatus` handle proto conversion. No new filtering or rendering logic was needed.

For multi-execution sessions (original + follow-ups), intermediate executions skip the `DoneEvent` so the TUI sees a continuous conversation. Only the final execution emits `DoneEvent`, activating the input composer for further follow-ups.

## Implementation Details

### New: `run_stream_snapshot.go`

Three public functions plus a helper:

- `snapshotToEvents(executions, events)` — goroutine iterating chronological executions, calling `emitSnapshotEvents` for each, then closing the channel.
- `emitSnapshotEvents(exec, events, emitDone)` — walks the execution's messages chronologically, emitting tool block events inline after AI messages that reference them (via `emitReferencedToolEvents`). This preserves the natural conversation interleaving: Human → AI → ToolCompleted → AI — matching the order the live gRPC path produces.
- `emitReferencedToolEvents(events, aiToolCalls, toolCallByID, emittedStates)` — emits stateful tool block events for tool calls referenced by an AI message, looking up final status from the top-level ToolCalls array.
- `emitToolEventByStatus(events, tc)` — dispatches a single tool call to the appropriate event type based on its status.

### Modified: `run_session.go`

`resumeSession` now creates an event channel, launches `snapshotToEvents`, and passes the channel to `executiontui.New()` — replacing the old `BuildSessionReplayBlocks` + `NewResumable` path. Removed the `display` package import (no longer needs `GetTerminalWidth()`).

### Deleted: `replay.go` (260 lines)

Removed in its entirety: `NewReplay`, `NewResumable`, `BuildReplayBlocks`, `BuildSessionReplayBlocks`, `buildToolCallBlocks`, `replayConvertToolCalls`, `replayConvertToolCall`, `replayMapToolCallStatus`, `replayComputeDuration`, `isReplayMode`, `replayViewportInit`.

### Simplified: `update.go`

Removed the `isReplayMode()` branch from `handleWindowSize` — viewport initialization now always uses `newViewport()`.

### Tests: `run_stream_snapshot_test.go` (10 tests)

- Event emission for messages, tool calls, and `DoneEvent`
- Chronological ordering: verifies event sequence matches live path (Human → AI → ToolCompleted → AI)
- `DoneEvent` suppression for intermediate executions
- Approval noise message filtering
- Non-noise system message preservation
- `isTrackedToolMessage` duplicate suppression
- Multi-execution sequencing (correct ordering, single `DoneEvent`)
- Channel close behavior
- `DoneEvent` carries phase and error info

## Benefits

- **Zero rendering drift**: Any improvement to the live event path (new event types, smarter filtering, better badges) automatically applies to resumed sessions
- **260 lines deleted, ~170 lines added**: Net addition of production code is modest while removing the entire replay path and adding comprehensive test coverage
- **Single constructor**: `executiontui.New()` is the only TUI entry point — `NewReplay` and `NewResumable` are gone
- **Zero risk to live path**: The event emission functions were not modified; only their callers changed

## Impact

- **Users**: `stigmer run <session-id>` on completed sessions now renders identically to live execution — clean lifecycle badges, no approval noise, no duplicate tool blocks
- **Maintainers**: One rendering path to understand, test, and evolve instead of two

## Related Work

- [fix-session-resume-unmarshal-bug](2026-02-24-230339-fix-session-resume-unmarshal-bug.md) — fixed the proto unmarshal issue that prevented session resume from working at all; this change addresses the rendering quality once resume works
- [fix-tui-scroll-during-input-mode](2026-02-24-225739-fix-tui-scroll-during-input-mode.md) — viewport scrolling fix that also applies to the now-unified resume path

---

**Status**: ✅ Production Ready
