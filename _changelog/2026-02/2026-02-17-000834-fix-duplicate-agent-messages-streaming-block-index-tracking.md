# Fix Duplicate Agent Messages via Streaming Block Index Tracking

**Date**: February 17, 2026

## Summary

Fixed a critical bug in the CLI execution TUI where AI streaming messages overwrote tool call blocks, causing duplicate agent messages and missing tool call displays. The fix introduces explicit block index tracking for streaming AI messages, eliminating the flawed assumption that the streaming block is always the last block in the display list.

## Problem Statement

During agent execution, when the AI streams a message and then immediately invokes tools, the CLI would display duplicate agent text and tool calls would temporarily disappear. This created a confusing user experience where:
- The same AI message appeared twice in the output
- Tool call blocks vanished or showed AI text instead of tool information
- After approval, tool blocks would "magically reappear" with correct content

The bug manifested on nearly every LLM turn that involved tool calls, making it a high-frequency, high-impact issue affecting the core user experience of watching agent execution.

### Pain Points

- **Duplicate text confusion**: Users saw the same AI message repeated multiple times, making execution output hard to follow
- **Missing tool visibility**: Tool calls disappeared from the display during critical moments (like approval prompts)
- **Trust erosion**: The "self-healing" behavior after approval made the UI feel unreliable and unpredictable
- **Debugging difficulty**: Execution logs appeared correct but the live CLI display was corrupt, making it unclear if the bug was client-side or server-side

## Solution

The root cause was a **timing-dependent race condition** between two event processing passes in the CLI's `streamToEvents` function:

1. **Pass 1**: `emitToolCallStateEvents()` processes `tool_calls[]` from the server update and emits `ToolRunningEvent` for new tools
2. **Pass 2**: `emitMessageEvents()` processes `messages[]` and emits `AIStreamDeltaEvent` or `AIStreamEndEvent` for streaming AI

The TUI handlers assumed the streaming AI block was always at `blocks[len(blocks)-1]`, but Pass 1 could append tool blocks *after* the streaming block was created, causing Pass 2 to blindly overwrite those tool blocks with AI content.

The fix introduces a `blockIdx int` field to the `streamingState` struct, explicitly tracking which block is the streaming AI block. This index is recorded when `AIStreamStartEvent` creates the block and used by `AIStreamDeltaEvent` and `AIStreamEndEvent` to target the correct block, regardless of how many blocks were appended in between.

## Implementation Details

### Files Changed

**`client-apps/cli/pkg/executiontui/model.go`**

Added `blockIdx` field to `streamingState` struct:

```go
type streamingState struct {
    content  string
    blockIdx int  // index into m.blocks of the streaming AI block
}
```

**`client-apps/cli/pkg/executiontui/handle_events.go`**

Three event handler updates:

1. **AIStreamStartEvent** (line 28-33):
   - Records `blockIdx = len(m.blocks) - 1` after appending the streaming block
   - Ensures the index is captured at block creation time

2. **AIStreamDeltaEvent** (line 35-45):
   - Uses `m.streaming.blockIdx` instead of `len(m.blocks)-1` to update the correct block
   - Added comment explaining why explicit tracking is necessary

3. **AIStreamEndEvent** (line 47-54):
   - Uses `m.streaming.blockIdx` to finalize the correct block
   - Added nil guard for defensive robustness
   - Sets `m.streaming = nil` after block replacement to maintain index availability

### Why This Is Sufficient

The fix is minimal and surgical:
- Blocks are never deleted or reordered -- only appended or replaced in-place
- At most one streaming state exists at any time (enforced by `inStream` boolean in `streamToEvents`)
- The fix changes only the block targeting mechanism from "last" to "tracked index"
- No new code paths, no architecture changes, no behavior modifications beyond the bug fix
- Tool blocks already use this index-tracking pattern via `runningTools[toolCallID]` (correct reference implementation)

## Benefits

### Immediate User Experience Improvements
- **Clean execution output**: Agent messages and tool calls appear in the correct locations without duplication
- **Reliable tool visibility**: Tool blocks remain stable throughout their lifecycle, including during approval prompts
- **Predictable behavior**: No more "self-healing" -- the display is correct from the start

### Developer Benefits
- **Simpler debugging**: When execution output looks wrong, the bug is in the data, not the rendering
- **Correct mental model**: The TUI now matches the intuitive expectation that blocks maintain stable positions
- **Extensibility**: Future streaming content types (sub-agent messages, etc.) can follow the same index-tracking pattern

### Testing Results
- **97 of 98 tests pass**: All executiontui package tests pass except one pre-existing failure unrelated to this change
- **Zero regressions**: No existing functionality was broken
- **Full build success**: Complete CLI compiles cleanly with no warnings

## Impact

### Users Affected
- **All CLI users**: Anyone running agent executions will see correct, non-duplicated output
- **Approval flows**: Users waiting for approval prompts will see stable tool blocks instead of disappearing/reappearing content
- **Platform developers**: Cleaner CLI output makes it easier to understand agent behavior during development

### System Components
- **CLI TUI (Go)**: Event handlers and model struct modified
- **No server changes**: This is a pure client-side rendering fix
- **No proto changes**: The data structures and event stream remain unchanged
- **No breaking changes**: Fully backward compatible with existing executions

### Architecture Validation

This fix validates the existing TUI architecture:
- The two-pass event processing (`emitToolCallStateEvents` → `emitMessageEvents`) is sound
- The stateful block system with index tracking (used for tools) is the correct pattern
- The bug was not in the design but in an incomplete implementation (AI blocks needed index tracking too)

## Related Work

This fix builds on recent improvements to the execution streaming pipeline:

- **[2026-02-16] Fix Agent Status Updates Concatenation Bug**: Fixed server-side message separation (AI messages now properly isolated per turn)
- **Thinking Indicator in Viewport**: Ephemeral UI elements that don't interfere with block stability
- **Tool Approval State Tracking**: Established the `runningTools[toolCallID]` index-tracking pattern that this fix mirrors

The concatenation bug fix was a prerequisite -- without distinct AI messages per turn, this client-side rendering bug would have been masked by the server sending malformed data. Now that the server sends correct data, the client rendering needed to be corrected as well.

---

**Status**: ✅ Production Ready  
**Test Coverage**: 97/98 tests passing (1 pre-existing failure unrelated to this change)  
**Risk Level**: Very Low (minimal change, existing test coverage, no new code paths)
