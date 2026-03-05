# Design Decision 001: Scrollback Clear via \033[3J] + Replay

**Status**: Accepted (amended)
**Date**: 2026-03-05 (Session 3), amended 2026-03-05 (Session 8)
**Context**: Bubbletea v2 migration, Phase 2

## Problem

The re-commit mechanism (used for Ctrl+O toggle, approval collapse, session header subject update) cleared the visible screen with `\033[2J` (Erase in Display), but this pushes content into terminal scrollback. The result: scrolling up after a toggle shows duplicate content -- the old content in scrollback plus the replayed content on screen.

## Research

Deep research into terminal rendering (Ink's architecture, Bubbletea v2's Cursed Renderer, xterm specification) confirmed that scrollback is fundamentally immutable once content enters it. No escape sequence, scroll region, or cursor trick can edit scrollback content. This is a terminal-level constraint, not a framework limitation.

Alternative approaches considered and rejected:
- **Mutable window** (keep everything in View): Cursed Renderer drops top lines when View exceeds terminal height -- users lose scrollback
- **All-in-View** with in-app pager: Same as above plus requires custom scroll mechanism
- **Targeted line-erasure**: Only works for content still on the visible screen
- **DECSTBM scroll regions**: Inconsistent across terminals
- **Alt-screen as redraw surface**: Unreliable scrollback interaction

## Decision

Add `\033[3J` (Erase Saved Lines) to the clear sequence during replay. The `\033[3J` is embedded at the start of the `tea.Println` payload inside `buildReCommitCmd`, so it executes *after* `tea.ClearScreen`'s `\033[2J`.

The terminal processes the combined sequence as:
1. `\033[2J\033[1;1H` — clear visible screen (pushes content to scrollback in modern terminals), reposition cursor
2. `\033[3J` — erase saved lines (wipes scrollback including what step 1 just pushed)
3. Rendered history content — fresh replay

The full session history is replayed from the in-memory event history.

## Amendment (Session 8): Ordering fix

The original implementation wrote `\033[3J` directly to `cfg.status` in `triggerReCommit()` *before* sending `reCommitMsg` to the Bubbletea program. This created a race: `\033[3J` cleared scrollback, but then `tea.ClearScreen`'s `\033[2J` pushed visible content *back into* scrollback — producing the exact duplication it was meant to prevent.

The fix moves `\033[3J` into the `tea.Println` payload inside `buildReCommitCmd`. Since `tea.Sequence` guarantees `tea.Println` runs after `tea.ClearScreen`, the ordering is now correct and atomic within a single Bubbletea event-loop tick.

## Trade-offs

- **Pre-session terminal history is lost on re-commit**. Commands run before the Stigmer session (ls, cd, git status, etc.) are cleared when the user presses Ctrl+O or when approval collapses. This matches Claude Code's observed behavior and is an accepted pattern for AI CLI tools.
- Re-commit is now safe for any purpose: Ctrl+O toggle, approval collapse, subject update.

## Terminal Support

`\033[3J` is xterm-standard, supported by: iTerm2, Ghostty, Kitty, Alacritty, WezTerm, macOS Terminal.app, Windows Terminal, VS Code integrated terminal.

## References

- Research report: `research.inline-rerender-without-scrollback-duplication/04.report.gpt.md`
- Implementation: `run_stream_inline_history.go` (`buildReCommitCmd`, `triggerReCommit`)
- Checkpoint: `checkpoints/2026-03-05-session-3.md`
