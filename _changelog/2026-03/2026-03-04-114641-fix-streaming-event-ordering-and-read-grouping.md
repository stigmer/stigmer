# Fix CLI Streaming Event Ordering and Read Group Splitting

**Date**: March 4, 2026

## Summary

Fixed agent message duplication in the inline streaming renderer by correcting event emission ordering in the gRPC-to-TUI bridge, and fixed read tool grouping that merged reads across AI message boundaries into a single group. Both issues were caused by architectural ordering decisions in the event pipeline, not by renderer bugs.

## Problem Statement

After the initial dedup fix (`021fc121`), two categories of visual bugs persisted in the inline streaming renderer:

1. **Agent text messages printed twice** — AI messages like "I have everything I need..." appeared once with the `●` bullet prefix (from streaming) and a second time without it (from `renderAIStreamEnd` after `streamedBytes` was reset by an interleaved tool event).
2. **Reads grouped across AI message boundaries** — when the agent said "Let me read the entry point..." (reads 1-3) then "Now checking the config..." (reads 4-7), all 7 reads were merged into a single "Read 7 files" group instead of two separate groups.

### Pain Points

- Agent reasoning messages appeared twice in the terminal, confusing users about whether the agent was repeating itself
- The duplicate appeared WITHOUT the `●` bullet prefix, making it visually inconsistent
- Read groups did not correspond to the AI messages that triggered them, breaking the narrative flow of the agent's work

## Solution

Two targeted fixes addressing the root causes in the event pipeline and renderer:

1. **Correct event emission order in `streamToEvents`** — separated `emitToolCallStateEvents` into a tracking phase (builds state map, collects events in a slice) and a deferred emission phase. Message events are now emitted BEFORE tool events within each `Recv()` iteration, ensuring `AIStreamEndEvent` reaches the renderer before `ToolCompletedEvent`.

2. **Flush reads on `AIStreamStartEvent`** — modified the renderer's type-guard switch to treat `AIStreamStartEvent` as a read group boundary. When a new AI message begins, any pending reads from the previous context are flushed, creating natural per-message read groups.

## Implementation Details

### Event Emission Reordering (`run_stream_events.go`)

Renamed `emitToolCallStateEvents` to `trackToolCallStates` and changed its signature to return a `[]executiontui.Event` slice instead of writing directly to the channel:

```go
// Build state map (used by isTrackedToolMessage), collect events
toolCallStates, toolCallResults, toolEvents := trackToolCallStates(
    execution.Status.ToolCalls, toolCallStates, toolCallResults, "",
)
// Emit message events FIRST
displayedCount, inStream = emitMessageEvents(
    cfg.events, messages, displayedCount, inStream, toolCallStates,
)
// THEN emit queued tool events
for _, ev := range toolEvents {
    if !trySendEvent(ctx, cfg.events, ev) { return }
}
```

The same reordering was applied inside `emitSubAgentEvents` in `run_stream_subagent.go`, which had the identical tool-before-message ordering.

### Root Cause Chain (Before Fix)

Within a single `Recv()` iteration where a tool completes and an AI message finishes streaming:

1. `emitToolCallStateEvents` emits `ToolCompletedEvent(get_mcp_server)` first
2. `emitMessageEvents` emits `AIStreamEndEvent` second
3. Renderer processes `ToolCompletedEvent` → falls into `default` case → calls `finishAIStreamIfNeeded()` → resets `streamedBytes = 0`
4. Renderer processes `AIStreamEndEvent` → `renderAIStreamEnd` sees `len(e.Content) > 0` (since `streamedBytes` is 0) → reprints full AI content without bullet prefix

After the fix, `AIStreamEndEvent` arrives before `ToolCompletedEvent`, so the stream closes normally and `finishAIStreamIfNeeded` is a no-op when the tool event arrives.

### Read Group Boundary (`run_stream_inline.go`)

The type-guard switch now distinguishes `AIStreamStartEvent` from the other AI stream events:

```go
switch event.(type) {
case executiontui.AIStreamStartEvent:
    r.flushPendingReads() // boundary: new AI message splits read groups
case executiontui.AIStreamDeltaEvent, executiontui.AIStreamEndEvent:
    // mid-stream: no flush
default:
    r.finishAIStreamIfNeeded()
    r.flushPendingReads()
}
```

`flushPendingReads` internally calls `finishAIStreamIfNeeded` when there are pending reads, which correctly closes the previous AI stream before flushing reads that belong to it.

### Test Coverage

Three new test cases in `run_stream_inline_test.go`:

- `TestInlineRenderer_NonReadToolBetweenAIStream_NoDuplication` — reproduces the exact duplication scenario with a non-read `ToolCompletedEvent` between AI stream events
- `TestInlineRenderer_ReadGroupSplitAtAIMessageBoundary` — two batches of 3 reads separated by `AIStreamStartEvent` render as two distinct "Read 3 files" groups
- `TestInlineRenderer_MultipleAIMessages_InterleavedTools_CorrectOrder` — end-to-end ordering test with multiple AI messages, read groups, and non-read tool completions

Existing tests for `trackToolCallStates` (formerly `emitToolCallStateEvents`) were updated to use the new signature that returns a slice instead of writing to a channel.

## Benefits

- Zero agent message duplication regardless of tool/message event interleaving within a `Recv()` cycle
- Read groups now correspond to the AI message that triggered them, preserving narrative flow
- Fix is structural (event ordering at the source) rather than defensive (guards in the renderer)
- Existing `isTrackedToolMessage` suppression continues to work because the state map is still populated before `emitMessageEvents`

## Impact

- **Inline streaming** — eliminates the remaining duplication path that the previous fix missed
- **Read grouping** — reads are now split at AI message boundaries, showing context-appropriate groups
- **Sub-agents** — same ordering fix applied, preventing the same class of bug in sub-agent event processing
- **Resume path** — unchanged; `snapshotToEvents` already emits in message-timeline order

## Related Work

- Supersedes the partial fix from `021fc121` (CLI Inline Tool Deduplication and Approval Border Fix)
- Extends the approach from `2026-03-04-101900` changelog (Running Suppression and AI Stream Race Condition)
- The `streamedBytes` reset race identified in the previous changelog was a symptom; this fix addresses the root cause (event emission ordering)

---

**Status**: Production Ready
**Timeline**: Single session
