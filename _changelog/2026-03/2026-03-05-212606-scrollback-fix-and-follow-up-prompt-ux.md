# Fix Scrollback Duplication + Follow-up Prompt UX Overhaul

**Date**: March 5, 2026

## Summary

Eliminated scrollback duplication in the re-commit mechanism by adding `\033[3J` (Erase Saved Lines) before screen clear, and overhauled the follow-up prompt to use Bubbletea v2's native cursor positioning -- placing a real blinking bar cursor on the input line with the hint footer below, matching modern CLI UX patterns.

## Problem Statement

Two distinct issues in the inline renderer's interactive experience:

### Pain Points

- **Scrollback duplication**: Every Ctrl+O toggle or approval collapse pushed the entire session history into the terminal scrollback buffer via `tea.ClearScreen` (`\033[2J`). Scrolling up after a few toggles revealed duplicated content -- a jarring experience that undermined trust in the tool.
- **Follow-up prompt layout**: The hint text ("enter send · ctrl+c exit") sat *above* the input line, the separator was a fixed 40 characters regardless of terminal width, and there was no real cursor -- just the terminal's default cursor falling at the end of the `View()` content.

## Solution

### Part A: Scrollback Fix

Added `\033[3J` (Erase Saved Lines) as a direct write to the terminal before sending the `reCommitMsg` to Bubbletea. This clears the scrollback buffer so that when `tea.ClearScreen` (`\033[2J`) fires, there's no stale content to duplicate. Also enabled subject update re-commit -- previously deferred because re-commit caused duplication.

### Part B: Prompt UX

Restructured the follow-up prompt rendering to use `tea.View.Cursor` for real cursor positioning. The new layout renders dynamically from model state: full-width separator (using live `termWidth` from `tea.WindowSizeMsg`) → input line with prompt marker → hint footer below. The cursor is placed precisely on the input line using `ansi.StringWidth()` for correct visual width of styled text.

## Implementation Details

- `triggerReCommit()` now writes `\033[3J` directly to `cfg.status` before `program.Send(reCommitMsg{})` -- safe because `\033[3J` only affects scrollback (invisible to Bubbletea's Cursed Renderer)
- `renderInline` event loop calls `triggerReCommit()` after subject mutation (was previously a no-op)
- New `renderTextInputView()` method on `inlineBubbleModel` computes the prompt layout and sets `tea.View.Cursor` with `Shape: tea.CursorBar`, `Blink: true`
- `textInputStartMsg` simplified to only carry `inputCh` (prompt no longer pre-rendered)
- `termWidth` tracked via `tea.WindowSizeMsg` in `Update()`
- Legacy follow-up paths (direct-write, key-reader) unchanged -- they don't have cursor API access

## Benefits

- Zero scrollback duplication on Ctrl+O toggle, approval collapse, and subject update re-commit
- Real blinking bar cursor on the follow-up input line
- Full-width separator adapts to terminal width
- Hint footer below input (out of the user's typing path)
- Subject updates now visually refresh the session header panel
- 4 new tests covering cursor position, width tracking, and separator rendering

## Impact

- **End users**: Cleaner scrollback history, more polished follow-up prompt interaction
- **Terminal compatibility**: `\033[3J` supported across iTerm2, Ghostty, Kitty, Alacritty, WezTerm, macOS Terminal.app
- **Codebase**: `textInputPrompt` field removed (simpler model), prompt rendering centralized in `renderTextInputView()`

## Related Work

- Part of project `20260305.03.bubbletea-v2-upgrade` (Phase 2 of 5)
- Builds on Phase 1: Mechanical v2 API migration
- Research: `research.inline-rerender-without-scrollback-duplication/04.report.gpt.md`
- Predecessor: `20260305.02.expand-collapse-tools` (built the re-commit mechanism)

---

**Status**: ✅ Production Ready
**Timeline**: Session 3 of bubbletea-v2-upgrade project
