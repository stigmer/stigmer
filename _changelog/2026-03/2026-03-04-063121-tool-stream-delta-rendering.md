# Phase 3.4: ToolStreamDeltaEvent Streaming

**Date**: March 4, 2026

## Summary

Enabled live tool content streaming in inline mode. Write/edit tools now display content progressively as the AI generates it (typewriter effect before approval). Shell tools stream command output live after the user approves execution. On completion or approval collapse, streaming output is erased via cursor control and replaced with the compact result.

## Problem Statement

Tool content streaming (`ToolStreamDeltaEvent`) was blanket-suppressed in inline mode since Phase 2.1b. This meant write/edit tools showed nothing during AI generation — the user waited with no feedback until the full content appeared in the approval prompt. Shell tools showed no output at all between approval and completion. Both cases created an opaque, low-confidence experience.

### Pain Points

- Write/edit approval showed content all at once after generation, with no progressive feedback during AI generation
- Shell output was invisible between user approval and tool completion — no indication of progress
- The blank waiting period reduced user confidence that the system was working

## Solution

Two streaming phases share the same delta-rendering infrastructure:

1. **Pre-approval streaming (write/edit)**: When a write/edit tool starts with `IsStreaming=true`, content appears line-by-line below a header+separator. When the approval prompt arrives, a bottom separator and question are appended below the already-visible content. After the user decides, everything is erased and replaced with the compact result.

2. **Post-approval streaming (shell)**: When the user approves a shell command, the expanded approval view is erased and replaced with a running header. Shell output streams below in real-time. On completion, everything is erased and replaced with the compact shell result.

## Implementation Details

### New file: `run_stream_inline_streaming.go` (115 lines)

Five methods on `inlineRenderer` encapsulating all streaming-specific rendering:

- `initPreApprovalStreaming` — prints header+separator, initializes streaming state
- `initPostApprovalStreaming` — prints compact running header, initializes streaming state
- `renderToolStreamDelta` — prints only new bytes since last delta, recomputes display row count from full accumulated content
- `completeStreamingTool` — erases streaming content (cursor control), prints final compact result, clears state
- `resolveStreamContent` — prefers `e.Content` (shell output), falls back to `ExpandedApprovalContent` (write/edit args)

Plus `clearStreamingState` helper for resetting all tracking fields.

### Modified: `run_stream_inline.go`

- Added streaming state fields to `inlineRenderer`: `activeStreamToolID`, `toolStreamedBytes`, `streamHeaderRows`, `streamLineCount`, `streamSubAgentID`
- Extended `waitingApprovalState` with `contentStreamed` and `streamedRows`
- Three new pre-switch interceptions in `handleEvent`:
  - Conditional `ToolStreamDeltaEvent` routing (replaces blanket suppression)
  - Streaming tool completion interception (before `suppressedToolIDs` check)
  - Write/edit streaming initiation on `ToolRunningEvent` with `IsStreaming=true`
- `renderToolWaitingApproval` captures streaming state at transition

### Modified: `run_stream_inline_approval.go`

- `resolveApprovalContext` now returns 5 values (added `contentStreamed`, `streamedRows`)
- Extracted `prepareApprovalDisplay` — handles streamed vs non-streamed display setup
- Extracted `finalizeApproval` — handles erase + collapse/shell-streaming + suppression + response
- Both interactive and non-interactive paths support content-already-streamed path and shell post-approval streaming

### Key design decisions

- **Full-content row recomputation on each delta**: Avoids partial-line overcounting from summing per-delta row counts, at O(n) per delta — acceptable for bounded terminal output
- **No indentation during shell streaming**: Raw output matches direct execution. `RenderCompact` applies indent + dim + truncation on completion — clean visual transition from ephemeral feedback to permanent record
- **Streaming tools bypass `suppressedToolIDs`**: Post-approval shell completions intercepted by `activeStreamToolID` check before `suppressedToolIDs`. Natural separation: streaming tools → `completeStreamingTool`, non-streaming approval tools → `suppressedToolIDs`
- **`toolStreamedBytes` (not `streamedBytes`)**: Renamed to avoid field collision with existing AI streaming state

## Benefits

- Progressive feedback during write/edit generation — user sees content appear as the AI types it
- Live shell output after approval — matches the experience of running the command directly
- Clean collapse: all streaming content erased and replaced with permanent compact record
- Graceful degradation: when cursor control unavailable (pipe, CI), content stays in scrollback with no erasure — some visual duplication but nothing breaks

## Impact

- **End users**: More responsive, transparent inline CLI experience. No more blind waiting during tool execution.
- **Codebase**: Streaming infrastructure is general-purpose — can be extended to other streaming tool types with minimal changes.
- **Architecture**: Approval flow now has three distinct output paths: content-already-streamed (write/edit), standard expanded view (non-streaming), and post-approval streaming (shell). All kept under 50 lines per function per coding guidelines.

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `cmd/stigmer/root/run_stream_inline_streaming.go` | 115 | **NEW** — streaming methods |
| `cmd/stigmer/root/run_stream_inline_streaming_test.go` | 597 | **NEW** — 32 streaming tests |
| `cmd/stigmer/root/run_stream_inline.go` | +52 | Streaming state fields, routing, waiting-approval capture |
| `cmd/stigmer/root/run_stream_inline_approval.go` | +148/-55 | Refactored with streaming paths |
| `cmd/stigmer/root/run_stream_inline_approval_test.go` | +23 | Updated for new return values + streaming assertions |
| `cmd/stigmer/root/BUILD.bazel` | +2 | New files |
| `pkg/toolrender/render_approval.go` | +5/-3 | Docstring update |

## Related Work

- Phase 3.0: Terminal cursor control primitives (`pkg/termctl`) — provides `EraseLines`, `DisplayRows`
- Phase 3.1: Custom inline prompter — provides `PromptWithLineCount` for row counting
- Phase 3.2: Approval result rendering — provides `ExpandedApprovalHeader`, `ExpandedApprovalContent`, `ApprovalSeparator`
- Phase 3.3: handleApproval rewrite — provided the orchestration framework this phase extends
- Phase 2.1b: Read grouping — established the `ToolStreamDeltaEvent` non-flush invariant

---

**Status**: Production Ready
**Timeline**: Phase 3.4 of inline-first CLI project
