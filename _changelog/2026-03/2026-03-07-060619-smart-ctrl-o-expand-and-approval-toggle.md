# Smart Ctrl+O Expand Hint, Approval Toggle, and Input Bar Preservation

**Date**: March 7, 2026

## Summary

Overhauled the Ctrl+O expand/collapse system across three dimensions: the hint is now intelligent (only shown when expanding would actually reveal more content), Ctrl+O works during approval prompts, and the input bar no longer disappears after toggling. These changes transform a rough prototype into a polished, production-quality expand/collapse experience.

## Problem Statement

The initial Ctrl+O expand hint implementation had several UX and functional issues that undermined its usefulness and created confusion.

### Pain Points

- **Misleading hints**: The "(ctrl+o to expand)" hint appeared on every compact tool line regardless of whether expanding would show more content — including single-read tools (where the user can just click the file link), write/edit tools (where the path is already clickable), and short thinking blocks (where the full content is already visible).
- **Blocked during approval**: Pressing Ctrl+O during an approval prompt had no effect because `promptApprovalViaChannel` was blocked on a single `decisionCh` receive, starving the `toggleExpandCh` signal.
- **Input bar vanishing**: After toggling Ctrl+O during the follow-up prompt phase, the separator + text input bar at the bottom of the screen disappeared. Root cause: `tea.ClearScreen` in Bubbletea v2's `cursedRenderer.clearScreen()` calls `scr.MoveTo(0, 0)`, which forces the renderer to position View() at the top-left of the terminal — overwriting history content and leaving the bottom (where the user expects the input bar) empty.

## Solution

Three targeted fixes, each addressing a distinct aspect of the expand system:

1. **Expandability predicates** — New `IsExpandable` and `IsReadGroupExpandable` functions in the `toolrender` package that analyze each tool's content against its truncation threshold.
2. **Approval-aware toggle** — Refactored `promptApprovalViaChannel` to use a `select` loop that listens on both `decisionCh` and `toggleExpandCh`, with a new `approvalReRenderMsg` to refresh the display without disrupting the approval flow.
3. **Two-phase re-commit** — Replaced the `tea.Sequence(tea.Raw(payload), tea.ClearScreen)` pattern with a two-phase approach: phase 1 suppresses `View()` while `tea.Raw` rewrites the terminal; phase 2 (`reCommitDoneMsg`) restores `View()` so the renderer writes it fresh at the correct cursor position.

## Implementation Details

### New file: `render_expandable.go`

Houses `IsExpandable(tc ToolCallInfo) bool` and `IsReadGroupExpandable(reads []ToolCallInfo) bool`. Per-tool-type logic:

| Tool type | Expandable when... |
|---|---|
| Read, Write, Edit, Delete | Never (always false) |
| Shell/Bash | Result exceeds `maxShellOutputLines + 1` (5+ lines) |
| Thinking | Thought text exceeds `maxThinkLines + 1` (5+ lines) |
| Discovery (Glob, Grep, List) | Non-empty result with entries |
| Unknown/MCP | Result exceeds `maxUnknownOutputLines + 1` (5+ lines) |
| Read groups | Entry count exceeds `maxVisibleInGroup + 1` (5+ entries) |

Failed tools always return false regardless of content.

### Modified: `run_stream_inline_history.go`

`renderCommittedItem` now gates the `appendExpandHint` call on the expandability predicates instead of the blanket `showExpandHint` flag. Each `committedKind` uses its appropriate predicate:
- `kindToolCompact` → `toolrender.IsExpandable(item.toolCalls[0])`
- `kindReadGroup` → `toolrender.IsReadGroupExpandable(item.toolCalls)`
- `kindSubAgentBlock` → `len(item.saBlock.children) > 0`

### Modified: `run_stream_inline_approval.go`

`promptApprovalViaChannel` now uses a `for { select { ... } }` loop:
- `case d = <-decisionCh:` → proceeds with approval decision
- `case <-r.cfg.toggleExpandCh:` → toggles expand mode, re-renders history, sends `approvalReRenderMsg`

### Modified: `run_stream_inline_bubbletea.go`

- Added `reCommitPending bool` field to `inlineBubbleModel`
- `View()` returns empty `tea.View` when `reCommitPending` is true
- `handleReCommit` sets `reCommitPending = true` before returning the re-commit Cmd
- New `handleReCommitDone` clears `reCommitPending` on `reCommitDoneMsg`
- `handleApprovalStart` and `handleApprovalShow` also set `reCommitPending` when using `buildReCommitCmd`

### Modified: `run_stream_inline_history.go` (buildReCommitCmd)

Replaced `tea.Sequence(tea.Raw(payload), tea.ClearScreen)` with `tea.Sequence(tea.Raw(payload), func() tea.Msg { return reCommitDoneMsg{} })`. The `reCommitDoneMsg` triggers phase 2 — the renderer sees a transition from empty to composed view and writes it at the current cursor position.

### New messages: `run_stream_inline_messages.go`

- `approvalReRenderMsg` — carries updated `reCommitPayload` for approval-phase toggles
- `reCommitDoneMsg` — phase 2 signal that clears `reCommitPending`

## Benefits

- **Reduced noise**: Users no longer see expand hints on tools where expanding adds no value (reads, writes, short content)
- **Unblocked approval flow**: Ctrl+O works seamlessly during approval prompts without interfering with the accept/reject decision
- **Stable UI**: The input bar (separator + text input or "esc to interrupt") remains visible across all expand/collapse toggles
- **Correct Bubbletea v2 rendering**: The two-phase re-commit avoids the `MoveTo(0,0)` cursor reset that caused View() to render at the wrong terminal position

## Impact

- **End users**: Cleaner, less cluttered TUI with expand hints that are actually actionable
- **Approval workflow**: Ctrl+O now works at every stage — during execution, during approval, and during follow-up
- **Code quality**: The expandability logic is centralized in `render_expandable.go` with clear per-tool predicates, making it easy to add new tool types

## Related Work

- Builds on [Add Ctrl+O to Expand Hint](2026-03-07-051048-add-ctrl-o-to-expand-hint.md) which introduced the initial hint mechanism
- Root cause analysis of Bubbletea v2's `cursedRenderer.clearScreen()` behavior documented for future reference

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (including deep-dive into Bubbletea v2 renderer internals)
