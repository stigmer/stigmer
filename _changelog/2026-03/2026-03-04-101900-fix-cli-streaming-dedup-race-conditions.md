# Fix CLI Streaming Duplication: Running Suppression and AI Stream Race Condition

**Date**: March 4, 2026

## Summary

Replaced the fragile in-place running-line erasure mechanism with universal running indicator suppression and fixed a race condition where `flushPendingReads` reset `streamedBytes` during `AIStreamEndEvent`, causing AI message content to be re-printed without its bullet prefix. Removed the dead code left behind by the approach change.

## Problem Statement

After the initial dedup fix (`936d2c90`), two categories of duplication persisted in the inline streaming renderer:

1. **Tool running indicators still appeared** — the `lastOutputWasRunning` + `termctl.EraseLines` mechanism assumed sequential event delivery, but interleaved events (AI messages, other tool events) between a running and completed event prevented erasure, leaving both visible.
2. **AI messages re-printed without bullet prefix** — when a `read_file` completion arrived during an AI stream, `flushPendingReads` ran before `AIStreamEndEvent`, calling `finishAIStreamIfNeeded` which reset `streamedBytes` to 0. When `renderAIStreamEnd` subsequently ran, it saw the full content as "new" and re-printed everything, producing a duplicate without the `●` prefix.

### Pain Points

- Tool running lines (e.g., `● List() …`) persisted when interleaved events prevented the erasure heuristic from triggering
- AI agent messages appeared twice: once via streaming (with `●` prefix) and once from the `streamedBytes` reset (without prefix)
- Dead code (`renderToolRunning`, `lastOutputWasRunning`, `termctl.EraseLines` calls) cluttered the renderer after the approach was abandoned

## Solution

Three targeted fixes applied to `run_stream_inline.go`:

1. **Catch-all running indicator suppression** — added a final `ToolRunningEvent` interception after all specific handlers (read, think, task, pre-approval streaming) that suppresses all remaining running events. Non-streaming tools now show only their completed result.
2. **Guard `flushPendingReads` during AI stream events** — moved `flushPendingReads()` from unconditional execution into the `default` case of the type-guard switch, so it never runs for `AIStreamStartEvent`, `AIStreamDeltaEvent`, or `AIStreamEndEvent`. This prevents the `streamedBytes` reset race.
3. **Dead code cleanup** — removed `renderToolRunning` function, `lastOutputWasRunning` field and its resets in `statusf`/`flushData`, the `termctl` import, and the erasure logic in `renderToolCompleted`.

## Implementation Details

### Running Indicator Suppression (`run_stream_inline.go`)

The catch-all `if _, ok := event.(executiontui.ToolRunningEvent); ok` block sits after all specific running-event interceptions (read/think suppression, pre-approval streaming initiation, task tool suppression). Any `ToolRunningEvent` that reaches this point is silently dropped. This is architecturally simpler than the previous approach — no state tracking, no terminal escape sequences, no edge cases with interleaved events.

### flushPendingReads Guard (`run_stream_inline.go`)

The type-guard switch now explicitly skips AI stream events:

```go
switch event.(type) {
case executiontui.AIStreamStartEvent, executiontui.AIStreamDeltaEvent, executiontui.AIStreamEndEvent:
    // AI stream events manage lifecycle internally.
default:
    r.finishAIStreamIfNeeded()
    r.flushPendingReads()
}
```

This prevents the chain: `flushPendingReads` → `finishAIStreamIfNeeded` → `streamedBytes = 0` → `renderAIStreamEnd` prints full content again.

### Test Updates (`run_stream_inline_test.go`)

- Replaced `TestInlineRenderer_ToolRunning_GoesToStderr` with `TestInlineRenderer_ToolRunning_Suppressed` — asserts running indicators produce no stderr output
- Replaced `TestInlineRenderer_ToolRunning_SetsLastOutputWasRunning` and `TestInlineRenderer_StatusfClearsRunningFlag` with `TestHandleEvent_AllRunningIndicatorsSuppressed` — validates suppression across 5 tool types
- Added `TestHandleEvent_RunningThenCompleted_NoDuplication` — end-to-end test proving running+completed sequence produces exactly one tool line
- Added `TestInlineRenderer_AIStreamEnd_WithPendingReads_NoDuplication` — reproduces the exact race condition (read completion during AI stream) and validates the fix

## Benefits

- Zero tool duplication regardless of event interleaving order
- Zero AI message duplication regardless of buffered read completions during streaming
- Simpler architecture: no terminal escape sequences, no state flags for running-line tracking
- 4 new/updated test cases covering both root causes

## Impact

- **Inline streaming** — eliminates all known duplication paths in the primary user-facing output
- **Code complexity** — net reduction: removed `renderToolRunning`, `lastOutputWasRunning` field/resets, `termctl` import
- **Test coverage** — old tests validated the removed mechanism; new tests validate the replacement behavior and the race condition fix

## Related Work

- Supersedes the in-place replacement approach from `936d2c90` (CLI Inline Tool Deduplication and Approval Border Fix)
- Informed by root cause analysis documented in plan `fix_cli_streaming_duplication_a55a0d9e`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
