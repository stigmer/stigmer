---
name: Streaming preview threshold
overview: Add a threshold-based collapse to pre-approval progressive streaming so that only the first N content lines are committed to scrollback, with remaining lines shown as a live-updating "... +M more lines" indicator in View().
todos:
  - id: bubbletea-threshold
    content: Add streamingCollapsed/streamingTotalLines fields to inlineBubbleModel and implement threshold logic in handleStreamingUpdate + reset in 5 handlers
    status: completed
  - id: helper-constant
    content: Add streamingPreviewLines constant and nthNewlineOffset helper to run_stream_inline_types.go
    status: completed
  - id: direct-write-cap
    content: Add streamCapped/streamContentLines fields to inlineRenderer and implement threshold in renderToolStreamDeltaDirect + reset in clearStreamingState
    status: completed
  - id: tests
    content: Add Bubbletea model tests for threshold crossing and direct-write tests for capped rendering
    status: completed
isProject: false
---

# Threshold-Based Collapse for Pre-Approval Streaming

## Problem

The current progressive commit architecture (introduced in the recent full-content pre-approval streaming change) commits **every** completed line of tool input to terminal scrollback via `tea.Println` during pre-approval streaming. When the AI writes a large file (e.g., a 100-line YAML config), all 100 lines scroll through the terminal in real time. While this content is ephemeral (atomically replaced by re-commit on tool completion or approval transition), the **live experience** is noisy and confusing -- raw file content is visually indistinguishable from AI reasoning text, as seen in the screenshot where YAML content (`apiVersion:`, `kind:`, `metadata:`) bleeds into the scrollback right after the AI's reasoning message.

## Solution

Introduce a **two-phase progressive streaming model** with a configurable preview threshold:

```mermaid
stateDiagram-v2
    [*] --> Preview: streamingShowMsg
    Preview --> Preview: line <= threshold
    Preview --> Collapsed: line > threshold
    Collapsed --> Collapsed: more lines arrive
    Collapsed --> [*]: re-commit (approval or completion)
    Preview --> [*]: re-commit (approval or completion)

    state Preview {
        direction LR
        note right of Preview: Lines committed to scrollback via tea.Println\nView() shows partial (incomplete) line
    }
    state Collapsed {
        direction LR
        note right of Collapsed: No new scrollback commits\nView() shows dim counter
    }
```



**Phase 1 -- Preview** (lines 1 through N): Identical to current progressive behavior. Each completed line is committed to scrollback, giving the user a live typewriter preview.

**Phase 2 -- Collapsed** (lines N+1 onward): Stop committing new lines. View() renders a single dim indicator: `"... +M more lines"` using the existing `toolrender.StreamTruncationIndicator`. The counter increments as content arrives. View() stays 1 row tall.

**Transition** (tool completion or approval): The existing re-commit mechanism atomically replaces all scrollback with the authoritative history. The preview lines and collapsed indicator vanish naturally. No change needed in `completeStreamingTool`, `handleApprovalStart`, or `finalizeApprovalViaBubbletea`.

## Key Design Decisions

- **Fixed threshold constant** (`streamingPreviewLines = 10`): Provides a predictable, consistent preview regardless of terminal size. More discoverable than terminal-height-dependent logic. Can be made configurable later if needed.
- **Reuse `toolrender.StreamTruncationIndicator`**: Already renders `"... +N more lines"` with dim styling. Consistent with the truncation indicators used in compact tool rendering.
- **Both paths**: Bubbletea (primary) and direct-write (fallback) both get threshold support for consistent UX across environments.

## Implementation

### 1. Bubbletea model -- `inlineBubbleModel` in [run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go)

Add two fields:

```go
streamingCollapsed  bool // true once content exceeds preview threshold
streamingTotalLines int  // total completed content lines (for indicator)
```

`**handleStreamingUpdate**` (lines 387-421): Replace the progressive commit block with threshold-aware logic:

- Count total completed lines in the content
- If `streamingCollapsed`: update `streamingTotalLines`, set `streamingContent` to `StreamTruncationIndicator(totalLines - streamingPreviewLines)`, return (no `tea.Println`)
- If total lines <= threshold: existing progressive behavior (commit new complete lines, show partial in View())
- If total lines crosses threshold: find byte offset of the Nth newline, commit any remaining un-committed lines up to that boundary via `tea.Println`, set `streamingCollapsed = true`, set indicator in `streamingContent`

**Reset points** -- add `streamingCollapsed = false` and `streamingTotalLines = 0` in:

- `handleStreamingShow` (line 352)
- `handleStreamingHide` (line 423)
- `handleApprovalStart` (line 284)
- `handleApprovalShow` (line 310)
- `handleReCommit` (line 506)

`**View()`** (lines 180-186): No change needed. The progressive branch already renders `m.streamingContent` as-is. When collapsed, `streamingContent` will contain the styled indicator string.

### 2. Direct-write path -- [run_stream_inline_streaming.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go)

Add fields to `inlineRenderer` (in [run_stream_inline_types.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_types.go)):

```go
streamCapped       bool // true once pre-approval content exceeds preview threshold
streamContentLines int  // logical content lines printed so far
```

`**renderToolStreamDeltaDirect**` (lines 162-166): Modify to enforce the threshold:

- Count newlines in the new delta bytes
- If under threshold: print normally (current behavior), increment `streamContentLines`
- If crossing threshold: print only the bytes up to the Nth newline, then print the initial indicator
- If already capped: compute overflow count, `EraseLines(1)` to erase the stale indicator, print updated indicator

`**clearStreamingState**` (lines 223-231): Reset `streamCapped` and `streamContentLines`.

### 3. Constant and helper -- [run_stream_inline_types.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_types.go)

```go
const streamingPreviewLines = 10
```

Add a small helper to find the byte offset of the Nth newline in a string:

```go
func nthNewlineOffset(s string, n int) int
```

### 4. Tests

- **[run_stream_inline_bubbletea_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea_test.go)**: Add test cases for `handleStreamingUpdate` covering: under-threshold (current behavior), crossing threshold (commit up to boundary + collapse), already-collapsed (indicator update only).
- **[run_stream_inline_streaming_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming_test.go)**: Add test cases for direct-write threshold behavior. Update the existing `approvalContentBudget` test reference if affected.

## What Does NOT Change

- `initPreApprovalStreaming`: still sends `streamingShowMsg{progressive: true}` unchanged
- `completeStreamingTool`: still adds compact result to history and triggers re-commit
- `handleApprovalStart` / approval flow: still atomically replaces scrollback via re-commit
- `renderToolStreamDelta` (event-loop side): still sends `streamingUpdateMsg` with full content
- Post-approval shell streaming (`progressive: false`): entirely unaffected
- `toolrender.StreamTruncationIndicator`: reused as-is

## Risks and Mitigations

- **Threshold too low**: Users might want to see more preview. Mitigation: 10 is a reasonable default; the constant is easy to tune. A future enhancement could let Ctrl+O toggle between collapsed/full streaming.
- **Sub-agent gutter wrapping**: The indicator is set in `streamingContent`; the existing View() branch already applies `GutterWrap` when `streamingSubAgent != ""`. No additional work needed.
- **Direct-write EraseLines(1) flicker**: The indicator line is replaced in-place on each delta. Terminal flickering should be negligible since EraseLines+print is fast and atomic.

