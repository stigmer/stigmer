# Emergency Terminal Restore on Crash

**Date**: March 3, 2026

## Summary

Added three layers of terminal protection to the Bubbletea execution TUI: a `runTUIWithProtection` wrapper with panic recovery and signal handling, and a `stigmer fix` escape hatch command. The terminal is now always restored to a usable state, even on crashes, SIGTERM, or SIGHUP.

## Problem Statement

When the execution TUI panics or the process receives SIGTERM/SIGHUP, the alt-screen terminal state was not restored. The user was left with an invisible cursor, disabled echo, and garbled output. Claude Code had real user complaints about exactly this class of bug. The only recovery was to blindly type `reset` in the terminal or open a new one.

### Pain Points

- SIGTERM (e.g., `kill <pid>`, Docker stop) left the terminal in alt-screen + raw mode
- SIGHUP (terminal disconnect) skipped all cleanup
- No escape hatch command existed for manual recovery
- Users of competing tools (Claude Code, Codex CLI) reported this as a top frustration

## Solution

Three components, one shared wrapper:

1. **`runTUIWithProtection`** wraps `tea.Program.Run()` with:
   - **Panic recovery**: `defer`/`recover` with three-tier terminal restoration (Bubbletea's `RestoreTerminal`, saved terminal state via `term.Restore`, raw ANSI escape sequences). Converts panics to actionable errors instead of raw stack traces.
   - **Signal handling**: Intercepts SIGTERM and SIGHUP, calls `p.Kill()` to immediately stop the TUI and restore terminal state. Bypasses the event loop (which may be stuck) — `Kill()` cancels the internal context directly. Handlers are registered per-TUI-invocation and deregistered on exit.

2. **Integration**: Both TUI entry points (`streamAgentExecution` and `resumeSession`) now call `runTUIWithProtection(p)` instead of `p.Run()`. One-line change at each site.

3. **`stigmer fix`**: An escape hatch command that restores terminal sanity by applying ANSI reset sequences and running `stty sane`. Designed to be typed blind when the terminal is broken.

## Implementation Details

- **`run_tui.go`** (new): `runTUIWithProtection` function with panic recovery and signal handler goroutine. `restoreTerminal` function with three-tier strategy (Bubbletea's own restore is guarded with a nested `recover()` since it panics if the program was never fully initialized).
- **`run_stream.go`**: `p.Run()` replaced with `runTUIWithProtection(p)` (line 126)
- **`run_session.go`**: `p.Run()` replaced with `runTUIWithProtection(p)` (line 147)
- **`fix.go`** (new): `stigmer fix` Cobra command — ANSI reset sequences + `stty sane`
- **`root.go`**: Registered `NewFixCommand()` under the "config" command group
- **`run_tui_test.go`** (new): 9 tests covering clean exit, panic recovery, signal handler lifecycle, `restoreTerminal` safety, and `stigmer fix` command behavior

## Design Decisions

- **`p.Kill()` over `p.Quit()`**: `Quit()` sends a message through the event loop, which may be stuck. `Kill()` cancels the internal context immediately and is guaranteed to unblock `Run()`.
- **Per-TUI signal registration**: Signal handlers are active only while the TUI is running. No global state, no interference with daemon or MCP signal handlers.
- **Panics become errors**: Per the UX mandate, raw stack traces are not actionable for users. Converted to error with `stigmer fix` suggestion.
- **`stty sane` over `term.MakeRaw`+`term.Restore`**: When the terminal is already in raw mode, `MakeRaw` saves the broken state and `Restore` re-applies it. `stty sane` unconditionally resets to a well-known cooked state.
- **Non-alt-screen programs excluded**: Progress spinners and approval prompts don't use alt-screen, so crash damage is minor (recoverable with `reset`).

## Discovery During Implementation

Bubbletea v1.2.4 has its own `recoverFromPanic` in the event loop that catches panics from Init/Update/View, restores the terminal, and returns nil error from `Run()`. Our wrapper's `recover()` is defense-in-depth for panics outside the event loop (terminal setup/teardown). The primary value of our wrapper is the SIGTERM/SIGHUP signal handling, which Bubbletea does not provide.

## Benefits

- Terminal is always restored on SIGTERM, SIGHUP, and panics
- No raw stack traces for users — actionable error messages with recovery instructions
- `stigmer fix` provides a discoverable escape hatch referenced in error messages
- Signal handler goroutine is properly lifecycle-managed (no leaks)
- Zero changes to existing TUI model or event handling logic

## Impact

- **Users**: Terminal is never left in a broken state after any exit scenario
- **Operators**: `kill` and Docker stop now produce clean shutdown instead of terminal corruption
- **Existing behavior preserved**: All 9 new tests pass alongside the full existing test suite
- **Test coverage**: Clean exit, panic recovery, signal handler cleanup, `restoreTerminal` safety, `stigmer fix` command (9 tests)

## Related Work

- Phase 1.1: Fix approval not surfaced on resume (`2026-03-03-204258`)
- Phase 1.2: Context-cancellable approval flow (`2026-03-03-205941`)
- Phase 1.3: Actionable stream error messages (`2026-03-03-211329`)
- Phase 1.5: Esc as cancel shortcut (`2026-03-03-212159`)

---

**Status**: Production Ready
