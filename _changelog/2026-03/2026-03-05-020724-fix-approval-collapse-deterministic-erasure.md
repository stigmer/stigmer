# Fix Approval Collapse: Replace Cursor Save/Restore with Deterministic Erasure

**Date**: March 5, 2026

## Summary

Replaced the fundamentally broken DEC cursor save/restore (`ESC 7` / `ESC 8`) mechanism in the approval collapse flow with a content viewport + deterministic `EraseLines` approach. This eliminates the persistent ghost content bug where expanded tool call previews and approval prompts remained visible after the user made a decision, instead of collapsing into a compact summary.

## Problem Statement

When a tool call (e.g., `write_file`) required approval, the CLI displayed an expanded preview of the content along with a Yes/Skip/Reject prompt. After the user chose an action, the expanded view was supposed to be erased and replaced with a one-line summary. Instead, the expanded content remained visible — sometimes doubled — leaving "ghost content" on screen.

### Pain Points

- Expanded approval content (80+ lines of YAML, file contents, etc.) persisted after user decision
- The collapsed summary appeared *below* the ghost content instead of replacing it
- Users lost trust in the approval flow — the UI looked broken and unprofessional
- The bug was reported as fixed in a previous changelog but persisted in production use

### Root Cause

The DEC cursor save/restore mechanism (`ESC 7` saves a *screen-relative* position, `ESC 8` restores it) is fundamentally incompatible with a streaming CLI where content regularly causes terminal scrolling:

1. `ESC 7` saves row 40 (bottom of a 40-row terminal)
2. 80 lines of content stream in, causing 80 scroll events
3. `ESC 8` restores to row 40 — which now points to the last line of content, not the start
4. `CSI J` (clear to end of screen) clears nothing meaningful

This is the *normal* case in a streaming CLI, not an edge case. Any non-trivial content triggers scrolling and silently breaks save/restore.

## Solution

**Content Viewport + Deterministic EraseLines**: Instead of trying to erase an unknown amount of content, cap the displayed content so its row count is known and small, then erase with `EraseLines(exact_count)`.

### Design Principles

- **Bounded content**: Expanded approval view never exceeds `termHeight - overhead` lines
- **Width-clamped lines**: Each line truncated to `termWidth - 1` columns, preventing wrapping
- **Deterministic erasure**: Known height + no wrapping = `EraseLines(N)` is exact
- **No cursor save/restore**: All `SaveCursor`/`RestoreCursorAndClear` removed from approval flow

## Implementation Details

### New Functions

- **`termctl.Height(w, defaultHeight)`** — Returns terminal height in rows, mirroring the existing `Width()` function
- **`toolrender.TruncateContent(content, maxLines, maxWidth)`** — ANSI-aware content truncation with overflow indicator
- **`toolrender.StreamTruncationIndicator(overflow)`** — Dim indicator line for capped streaming content
- **`toolrender.GutterWidth()`** — Returns visible width of the sub-agent gutter prefix
- **`approvalContentBudget(termHeight)`** — Computes max content lines from terminal geometry

### Key Changes

**Struct fields** (`run_stream_inline.go`):
- Removed: `cursorSaved bool`
- Added: `maxStreamContentLines`, `streamContentLines`, `streamTruncationShown`

**Pre-approval streaming** (`run_stream_inline_streaming.go`):
- `initPreApprovalStreaming` computes content line cap from terminal height instead of saving cursor
- `renderToolStreamDelta` caps content at `maxStreamContentLines`, width-clamps each line, and shows a truncation indicator updated in-place when the cap is hit
- Post-approval streaming (shell tools) remains uncapped

**Approval display** (`run_stream_inline_approval.go`):
- `prepareApprovalDisplay` uses `EraseLines` for streamed content erasure, passes `maxContentLines` to `buildExpandedView`
- `buildExpandedView` applies `TruncateContent` to cap and width-clamp content
- `finalizeApproval` always uses `EraseLines(totalRows)` with `termHeight` defense-in-depth cap
- `handleNonInteractiveApproval` and `handlePromptError` use `EraseLines` exclusively

### Files Modified (10 files, ~450 lines changed)

| File | Change |
|------|--------|
| `client-apps/cli/pkg/termctl/termctl.go` | Added `Height()` |
| `client-apps/cli/pkg/termctl/termctl_test.go` | Height tests |
| `client-apps/cli/pkg/toolrender/render_approval.go` | `TruncateContent`, `StreamTruncationIndicator` |
| `client-apps/cli/pkg/toolrender/render_approval_test.go` | Truncation + indicator tests |
| `client-apps/cli/pkg/toolrender/render_compact.go` | `GutterWidth()` |
| `client-apps/cli/cmd/stigmer/root/run_stream_inline.go` | Struct field updates |
| `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go` | Core approval flow rewrite |
| `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval_test.go` | Deterministic erasure tests |
| `client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go` | Content capping in streaming |
| `client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming_test.go` | Streaming cap tests |

## Benefits

- **Reliable collapse**: Approval content is always fully erased regardless of terminal size or content length
- **No ghost content**: The 80+ line ghost content scenario is eliminated structurally
- **Scroll-immune**: `EraseLines(N)` works correctly even when the display caused scrolling, because it moves up from the *current* cursor position
- **Resize-safe**: Width-clamped lines won't wrap even if the terminal narrows between render and erase
- **Simpler mental model**: No invisible cursor state to reason about — just "we printed N rows, erase N rows"

## Impact

- **End users**: Approval prompts now reliably collapse into compact summaries after any decision
- **All tool types**: Write, edit, create, delete, shell, and MCP tools all benefit
- **Sub-agent tools**: Gutter-wrapped content is correctly width-budgeted
- **Non-interactive mode**: `--approve-all` / `--reject-all` erasure is also fixed

## Related Work

- Previous fix attempt: `2026-03-05-004607-fix-approval-collapse-and-followup-prompt-ux.md` (DEC cursor save/restore — now superseded)
- `Unwrap()` for writer chain fix (retained — still needed for `IsSupported` checks)
- `DisplayRows` calculation (retained — used for overhead rows, but content rows are now deterministic)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (analysis + implementation + testing)
