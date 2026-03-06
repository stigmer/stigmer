# Fix pre-approval streaming header/content race condition

**Date**: March 6, 2026

## Summary

Fixed an intermittent race condition where tool content (e.g. YAML lines from a Write tool) appeared visually mixed with the preceding AI message during pre-approval streaming. The root cause was that the tool header was committed to scrollback via a Bubbletea `Cmd` goroutine, which could be overtaken by subsequent content messages. Also fixed AI message data loss during the streaming-to-approval transition.

## Problem Statement

During pre-approval streaming of write/edit tools, two visual defects appeared:

### Pain Points

- **Transient content mixing**: YAML content from a tool (e.g. `apiVersion`, `kind`, `metadata`) appeared above the tool header, visually mixed with the preceding AI message. This was intermittent and depended on goroutine scheduling.
- **AI message data loss**: The AI message ("I have everything I need. Let me now write the YAML file") that appeared during streaming was missing from the final view after the recommit, because `renderAIStreamEnd` returned early without recording the message when `inAIStream` was false.

## Solution

### Race condition fix

Moved the progressive tool header commit from the Bubbletea model handler (`handleStreamingShow`, which returned `tea.Println(header)` as an asynchronous `Cmd`) to the renderer goroutine (`commitStreamHeader`, which calls `program.Println` directly). Since `program.Println`, `program.Send(streamingShowMsg)`, and `program.Send(streamingUpdateMsg)` are all called sequentially from the same goroutine and all enqueue to the same `p.msgs` channel, their FIFO ordering is guaranteed — no Cmd goroutine involved.

### AI message fix

Added a fallback in `renderAIStreamEnd` to call `recordAIMessage` even when `inAIStream` is false, ensuring the final AI message content from `AIStreamEndEvent` is always preserved in history.

## Implementation Details

### Files modified

- **`run_stream_inline_streaming.go`**: Added `commitStreamHeader` helper that commits the header synchronously via `program.Println` (line-by-line split). Updated `initPreApprovalStreaming` and `renderToolStreamDelta` (deferred header path) to call `commitStreamHeader` before sending `streamingShowMsg` without a `header` field. Added `streamIsPreApproval` tracking.
- **`run_stream_inline_bubbletea.go`**: Simplified `handleStreamingShow` progressive branch to just set state (`m.streamingHeader = ""; return m, nil`) — no more `tea.Println(header)` Cmd.
- **`run_stream_inline_bubbletea_test.go`**: Updated `TestInlineBubbleModel_StreamingShow_Progressive` to expect `nil` Cmd. Added `TestInlineBubbleModel_StreamingUpdate_ProgressiveLargeContent` for 50-line progressive streaming.
- **`run_stream_inline_streaming_test.go`**: Added tests for pre/post-approval direct-write streaming, `clearStreamingState` reset, and `initPreApprovalStreaming` flag.
- **`run_stream_inline_types.go`**: Added `streamIsPreApproval` field to `inlineRenderer`.
- **`run_stream_inline_aistream.go`**: Added fallback `recordAIMessage` call when `AIStreamEndEvent` arrives with `inAIStream=false`.

### Message ordering — before vs after

**Before (racy)**:
```
p.msgs: [streamingShowMsg] [streamingUpdateMsg]
             ↓
         Update → Cmd goroutine → [printLineMessage]  ← may arrive late
             ↓
         picks up streamingUpdateMsg → View() shows YAML without header
```

**After (deterministic)**:
```
p.msgs: [printLineMessage(header)] [streamingShowMsg] [streamingUpdateMsg]
             ↓                           ↓                    ↓
         insertAbove(header)    sets state only       processes content
```

## Benefits

- Eliminates the intermittent visual artifact where tool content appears mixed with AI messages
- Prevents AI message data loss during streaming-to-approval transitions
- Deterministic message ordering with no reliance on goroutine scheduling
- All pre-approval streaming content flows fully expanded — no truncation or collapsing

## Impact

- **CLI users**: No more confusing transient display of tool content above its header during pre-approval streaming
- **Data integrity**: AI messages are always preserved in history, surviving recommit cycles

## Related Work

- [Full content pre-approval streaming](2026-03-06-021906-full-content-pre-approval-streaming.md) — progressive commit to scrollback model
- [Fix duplicate write block in approval scrollback](2026-03-06-001520-fix-duplicate-write-block-in-approval-scrollback.md) — recommit architecture
- [Fix recommit scrollback duplication via raw](2026-03-06-013928-fix-recommit-scrollback-duplication-via-raw.md) — atomic raw recommit

---

**Status**: ✅ Production Ready
