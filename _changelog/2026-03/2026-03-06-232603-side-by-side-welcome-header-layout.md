# Side-by-Side Welcome Header with Adaptive Layout

**Date**: March 6, 2026

## Summary

Refactored the session welcome header panel to display metadata and recent sessions in a side-by-side two-column layout with a vertical divider on wide terminals. Narrow terminals gracefully fall back to the original stacked layout, preserving correctness across all terminal sizes.

## Problem Statement

The welcome header stacked all content vertically — greeting, metadata (Agent, Session, Subject, Workspaces), and recent sessions — inside a fixed 70-character panel. On modern wide terminals this wastes horizontal space and pushes the first user prompt further down the screen.

### Pain Points

- Recent sessions occupy 8–10 vertical lines beneath metadata, delaying the start of the actual session
- The fixed 70-char panel leaves significant horizontal space unused on typical 120+ column terminals
- No visual separation between the current session's metadata and the historical recent sessions list

## Solution

Introduced an adaptive two-column layout inside the existing branded panel. On terminals >= 100 columns wide, the metadata (left) and recent sessions (right) are composed side-by-side with a dim vertical divider (`│`). The panel width scales to the terminal, capped at 120 columns. On narrow terminals (< 100 cols), the layout falls back to the original stacked arrangement with no visual change.

## Implementation Details

### New layout engine (`run_stream_inline_header.go`)

- **`formatHeaderPanel(info, termWidth) (string, int)`** — pure, testable core function that returns both the content string and the panel width. Decides layout based on terminal width, presence of recent sessions, and available column space.
- **`composeSideBySide(metadata, sessions, rightWidth)`** — uses `lipgloss.JoinHorizontal(lipgloss.Top, ...)` to horizontally compose three columns: metadata block, dim `│` divider column, and width-constrained recent sessions block. The divider is built to match the height of the tallest column.
- **`formatRecentSessionsForWidth(sessions, width)`** — width-aware variant of the recent sessions formatter. Pre-computes timestamp widths for consistent column alignment, truncates long subjects and session IDs with `…` via rune-aware `truncateStr`.
- **`terminalWidth()`** — queries `term.GetSize(os.Stdout.Fd())` with fallback to `panel.DefaultWidth` (70) for non-TTY environments.
- **`headerPanelWidth(termWidth)`** — computes optimal panel width: `min(termWidth - 2, 120)` with a floor of `panel.DefaultWidth`.

### Constants governing layout thresholds

| Constant | Value | Purpose |
|---|---|---|
| `minSideBySidePanelWidth` | 96 | Minimum panel width to activate two-column layout |
| `maxHeaderPanelWidth` | 120 | Cap to prevent absurdly wide panels |
| `minRightColumnWidth` | 36 | Minimum right column width before falling back to stacked |

### Re-commit path (`run_stream_inline_history.go`)

- `renderHeaderItem` now calls `formatHeaderPanel` with the current terminal width, ensuring re-commits (e.g., after terminal resize or Ctrl+O toggle) re-evaluate the layout.

### Test coverage

Added 20+ new test cases covering the side-by-side layout, narrow fallback, column composition, width-constrained recent sessions, rune-aware truncation, panel width computation, and ANSI-aware line width measurement. All existing tests pass unchanged.

## Benefits

- **Compact header**: Side-by-side layout reduces header height by ~40%, getting the user to their first prompt faster
- **Adaptive**: Automatically selects the best layout for the terminal width — no user configuration needed
- **Graceful degradation**: Narrow terminals see exactly the same stacked layout as before
- **Testable**: The core layout function is pure (accepts width as parameter), making it deterministic and easy to test without mocking terminal state

## Impact

- **End users**: Immediately visible improvement in the session start experience on wide terminals
- **Codebase**: First use of `lipgloss.JoinHorizontal` in the CLI, establishing a pattern for future multi-column layouts
- **No breaking changes**: The stacked layout remains the default when terminal width is unknown or insufficient

## Related Work

- [Branded Welcome Header with Recent Sessions](_changelog/2026-03/2026-03-05-231338-branded-welcome-header-with-recent-sessions.md) — introduced the welcome header and recent sessions feature that this change enhances

---

**Status**: ✅ Production Ready
