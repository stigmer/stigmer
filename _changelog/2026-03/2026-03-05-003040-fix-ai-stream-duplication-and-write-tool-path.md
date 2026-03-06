# Fix AI Stream Duplication and Write Tool Empty Path

**Date**: March 5, 2026

## Summary

Fixed two persistent rendering bugs in the CLI inline renderer: (1) AI agent messages duplicating when a streaming write tool starts mid-AI-stream, and (2) the Write tool header showing empty brackets (`Write()`) during pre-approval streaming because the tool's Args are not yet populated. The duplication fix makes the renderer resilient to ALL possible event interleavings, closing the class of bugs rather than patching individual scenarios.

## Problem Statement

After multiple iterations of fixing AI message duplication (commits `021fc121`, `2026-03-04-114641`, `2026-03-04-101900`), the bug persisted in a specific scenario that the previous fixes did not cover: when a streaming write tool's `ToolRunningEvent` arrives while the AI is still streaming, spanning two separate `Recv()` calls.

### Pain Points

- Agent reasoning messages like "I have everything I need..." appeared twice in the terminal — once from streaming, once reprinted in full when `AIStreamEndEvent` arrived after a force-close
- The Write tool header showed `Write()` with empty brackets during the pre-approval streaming phase, even though the file path was available in subsequent events
- Users could not see which file was being modified until after the approval decision — a critical UX gap for informed approval
- Previous fixes addressed only within-batch event ordering; the cross-batch scenario was missed because it requires a specific interleaving of AI streaming and tool execution

## Solution

### AI Duplication: Renderer Idempotency Guards

Added early-return guards to `renderAIStreamDelta` and `renderAIStreamEnd` that check `r.inAIStream` before processing. When `finishAIStreamIfNeeded()` force-closes an AI stream (setting `inAIStream = false`), any late-arriving delta or end events from subsequent `Recv()` calls are silently ignored.

This is the standard resilience pattern for event-driven systems where events can arrive after state transitions. Rather than trying to fix specific interleavings, the renderer is now robust against ALL possible orderings.

### Write Path: Deferred Header + Fallback Fields

Two coordinated changes:

1. **Fallback fields** for write/edit/delete tools in `toolDisplayMap` — handles argument name variance across agent frameworks (`file_path`, `file`, `filename` in addition to `path`)
2. **Deferred header rendering** — when the tool's primary arg is not yet available at `ToolRunningEvent` time, header rendering is deferred to the first `ToolStreamDeltaEvent`, which carries an updated `ToolCall` with populated Args

## Implementation Details

### Renderer Idempotency (`run_stream_inline.go`)

```go
func (r *inlineRenderer) renderAIStreamDelta(e executiontui.AIStreamDeltaEvent) {
    if !r.inAIStream {
        return
    }
    // ... existing delta logic
}

func (r *inlineRenderer) renderAIStreamEnd(e executiontui.AIStreamEndEvent) {
    if !r.inAIStream {
        r.streamedBytes = 0
        return
    }
    // ... existing end logic
}
```

### Root Cause Chain (Before Fix)

Within two successive `Recv()` iterations:

1. Recv N: AI still streaming + write tool appears as `running` with `IsStreaming=true`
2. `emitMessageEvents` emits `AIStreamDeltaEvent` (message still streaming)
3. `trackToolCallStates` collects `ToolRunningEvent(write, streaming=true)`
4. Renderer: delta updates `streamedBytes` → `ToolRunningEvent` triggers `initPreApprovalStreaming` → calls `finishAIStreamIfNeeded()` → resets `streamedBytes = 0`, `inAIStream = false`
5. Recv N+1: AI message finishes → `emitMessageEvents` emits `AIStreamEndEvent` with full content
6. Renderer: `renderAIStreamEnd` sees `streamedBytes = 0` → prints ENTIRE content again

After the fix, step 6 checks `!r.inAIStream` and returns immediately.

### Deferred Header (`run_stream_inline_streaming.go`)

Added `streamHeaderDeferred bool` field to `inlineRenderer`. In `initPreApprovalStreaming`, when `toolrender.HasPrimaryArg()` returns false, the header is deferred. On the first `ToolStreamDeltaEvent`, the deferred header is rendered using the delta event's `ToolCall` (which carries updated Args).

Extracted `renderStreamHeader()` as a shared helper used by both the immediate and deferred paths, eliminating the previous code duplication between `initPreApprovalStreaming`'s inline header rendering and any future rendering needs.

### Fallback Fields (`render.go`)

Added `fallbackFields: []string{"file_path", "file", "filename"}` to all write, edit, and delete tool entries in `toolDisplayMap`. This matches the pattern already established for read tools.

Added `HasPrimaryArg(tc ToolCallInfo) bool` as a new exported function that checks whether a tool call's args contain the primary display argument (or any fallback).

### Test Coverage

6 new tests across two packages:

**Inline renderer** (`run_stream_inline_test.go`):
- `TestInlineRenderer_StreamingWriteToolDuringAIStream_NoDuplication` — reproduces the exact cross-Recv() duplication scenario
- `TestInlineRenderer_AIStreamDelta_AfterForceClose_Ignored` — verifies late deltas and end events are dropped
- `TestInlineRenderer_DeferredHeader_RendersPathFromDelta` — verifies path appears when Args are nil in ToolRunningEvent but populated in first delta
- `TestInlineRenderer_ImmediateHeader_WhenArgsPresent` — verifies no deferral when Args are present

**Tool render** (`render_test.go`):
- 4 fallback field tests for write/edit/delete tools
- 7 `HasPrimaryArg` tests covering known tools, unknown tools, nil args, fallback fields

## Benefits

- AI message duplication is now structurally impossible regardless of event interleaving — the renderer is idempotent for stream events after force-close
- Write/edit/delete tools show the file path during pre-approval streaming when Args are available in any event
- Argument name variance across agent frameworks is handled via fallback fields
- The deferred header pattern gracefully handles the timing gap between tool creation and arg hydration

## Impact

- **End users**: No more duplicated agent messages; file paths visible before making approval decisions
- **Inline streaming**: Both bugs are eliminated for all tool types, not just the specific scenarios observed
- **Test coverage**: The cross-Recv() scenario is now explicitly tested, preventing regression

## Related Work

- Supersedes partial fixes from `021fc121` (CLI Inline Tool Deduplication), `2026-03-04-101900` (Running Suppression), and `2026-03-04-114641` (Event Ordering)
- The `!r.inAIStream` guard pattern closes the class of duplication bugs rather than patching individual interleavings
- Fallback fields mirror the pattern established for read tools in `toolDisplayMap`

---

**Status**: Production Ready
**Timeline**: Single session
