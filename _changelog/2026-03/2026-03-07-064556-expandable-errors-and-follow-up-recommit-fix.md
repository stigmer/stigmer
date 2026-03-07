# Universal Error Expandability and Follow-up Re-commit Fix

**Date**: March 7, 2026

## Summary

Two bugs in the Ctrl+O expand/collapse system have been fixed: (1) truncated error messages across all tool types are now expandable, revealing the full error when the user presses Ctrl+O, and (2) the follow-up input bar (separator, `>` prompt, hint text) no longer vanishes after toggling Ctrl+O during the follow-up prompt.

## Problem Statement

After the initial Ctrl+O expand system was shipped, two issues were discovered in production:

1. **Truncated error messages were never expandable.** All tool types truncate error messages to 60 characters in compact mode (`✗ MCP server 'planton' in org 'default' not found. Verify...`), but the expandability predicates short-circuited to `false` for any error — even when the compact display was clearly truncating content. The expanded renderer also reused the same truncated 60-char display, so even if a tool were marked expandable, the expanded view showed the identical truncated text.

2. **Follow-up input bar disappeared after Ctrl+O.** During the follow-up prompt phase, pressing Ctrl+O caused the separator line, `>` prompt, and `enter send · ctrl+c exit` hint to vanish. Only the blinking cursor remained, and while typing still worked functionally, the entire visual chrome was invisible.

### Pain Points

- MCP tool errors (e.g., "MCP server not found") showed truncated output with no way to see the full message
- The Ctrl+O hint (`ctrl+o to expand`) didn't appear for tools with truncated errors, making the feature undiscoverable
- The follow-up input bar became invisible after any Ctrl+O toggle, forcing users to type blind or restart
- The `>` prompt, separator, and helper text were all missing — only the raw terminal cursor was visible

## Solution

### Bug 1: Universal Error Expandability

A three-layer fix applied uniformly across all tool types (Shell, Read, Write/Edit, Delete, Discovery, Thinking, Unknown/MCP):

1. **Shared `isErrorExpandable` predicate** — determines whether the compact error display truncates content. Returns true when the error message exceeds `maxErrorDisplayLen` (60 chars) or when a result-prefixed error (`"Error: ..."`) has multiple lines of content.

2. **All expandability predicates updated** — `isContentExpandable`, `isThinkExpandable`, `isDiscoveryExpandable`, `isUnknownExpandable`, and the `IsExpandable` dispatcher for Read/Write/Delete now delegate to `isErrorExpandable` before returning false for errors. Short errors (< 60 chars, single line) remain non-expandable.

3. **Full-error expanded rendering** — a shared `renderExpandedErrorContent` function shows the complete error text without truncation. For result-prefixed errors, all lines of `tc.Result` are shown with the `"Error: "` prefix replaced by the `✗` indicator. For explicit `tc.Error` fields, the full multi-line text is displayed. Each tool's expanded renderer now uses this instead of delegating to the truncated compact error path.

### Bug 2: Renderer-Aware Follow-up Re-commit

The root cause was diagnosed by reading the Bubbletea v2 `cursedRenderer` source. The existing two-phase re-commit uses `tea.Raw` to clear the screen and rewrite history — this bypasses the renderer, permanently desyncing its internal cursor position tracking. In inline mode, the renderer uses relative cursor movements, so all subsequent `View()` writes land at stale terminal coordinates. The text content (separator, prompt, hint) was written off-screen while the terminal cursor (placed via absolute escape sequences) appeared at the correct location.

The fix introduces a separate re-commit path for follow-up mode (`buildFollowUpReCommitCmd`) that uses renderer-aware operations instead of `tea.Raw` for the history rewrite:

1. `tea.Raw(clearAndHome)` — physically clears the terminal and scrollback
2. `tea.ClearScreen` — resets the renderer's position tracking to (0,0)
3. `reCommitDoneMsg` — clears `reCommitPending` so `View()` renders the input bar at the tracked position
4. `tea.Println(history)` — uses `insertAbove` to insert history above the view, pushing the input bar to the bottom while keeping the renderer's position tracking in sync

The execution-mode re-commit path (using `tea.Raw`) is unchanged — the desync is acceptable there because the view is small ("esc to interrupt") and corrected on the next full re-commit.

## Implementation Details

### Files Changed

- `client-apps/cli/pkg/toolrender/render_compact.go` — extracted `maxErrorDisplayLen = 60` constant; replaced all 7 hardcoded `60` values in `truncate(errMsg, 60)` calls
- `client-apps/cli/pkg/toolrender/render_expandable.go` — added `isErrorExpandable` helper; updated all 5 expandability predicates; updated `IsExpandable` dispatcher for Read/Write/Delete/default
- `client-apps/cli/pkg/toolrender/render_expanded.go` — added `renderExpandedErrorContent` helper; added `renderExpandedRead`, `renderExpandedWrite`, `renderExpandedDelete` functions; updated Shell/Think/Discovery/Unknown expanded renderers to use full error rendering
- `client-apps/cli/pkg/toolrender/render_expandable_test.go` — renamed 3 test functions for accuracy; added `TestIsExpandable_LongErrors_Expandable` with 9 test cases covering all tool types
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go` — `handleReCommit` now detects follow-up mode and dispatches to `buildFollowUpReCommitCmd`
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_history.go` — added `buildFollowUpReCommitCmd` using `tea.ClearScreen` + `tea.Println` instead of `tea.Raw`

### Key Design Decisions

- **Universal, not MCP-only**: The error expandability fix applies to all tool types. Every compact renderer uses the same `truncate(errMsg, maxErrorDisplayLen)` pattern, so every tool type benefits equally from the shared `isErrorExpandable` predicate.
- **Shared constant**: The `maxErrorDisplayLen = 60` constant ensures the expandability check and the compact rendering always use the same threshold — a change in one place affects both.
- **Two re-commit strategies**: Follow-up mode uses renderer-aware operations; execution mode keeps the existing `tea.Raw` path. This avoids changing the well-tested execution path while fixing the follow-up regression.
- **No `reCommitPending` suppression for Println**: The follow-up path still sets `reCommitPending = true` during the `tea.Raw(clearAndHome)` phase (to prevent renderer interference during the physical clear), but clears it before `tea.Println` so the view is rendered and `insertAbove` can calculate the correct view height.

## Benefits

- Truncated error messages across all tool types now show the Ctrl+O expand hint
- Expanding reveals the full error text — no more 60-char truncation in expanded mode
- The follow-up input bar (separator, prompt, hint) survives Ctrl+O toggles
- The renderer's cursor tracking stays in sync during follow-up re-commits
- The `maxErrorDisplayLen` constant eliminates the risk of expandability/rendering threshold mismatch

## Impact

- **End users**: Can now read full error messages from any tool (MCP, Shell, Read, etc.) by pressing Ctrl+O. The follow-up prompt is no longer disrupted by expand toggles.
- **Maintainers**: The `isErrorExpandable` and `renderExpandedErrorContent` helpers provide a single place to modify error expandability and rendering logic for all tool types.

## Related Work

- [Smart Ctrl+O expand and approval toggle](2026-03-07-060619-smart-ctrl-o-expand-and-approval-toggle.md) — the initial Ctrl+O system that this changelog fixes issues in

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours
