# Always-Visible Input Bar with Escape-to-Interrupt

**Date**: March 6, 2026

## Summary

Restructured the BubbleTea View from a flat mutually-exclusive switch into a composed layout with a persistent input bar at the bottom of the terminal. The input bar is always visible during interactive sessions, showing "esc to interrupt" during agent processing and transitioning to an active text input for follow-up messages. Also added a 1-line "current task" indicator extracted from the plan/todo list, and in-place plan updates that replace stale snapshots via re-commit instead of accumulating in scrollback.

## Problem Statement

The previous UX had two gaps compared to industry-leading CLI agents (e.g., Claude Code):

1. **No visible interaction affordance during processing.** When the agent was working, the terminal showed only a spinner or streaming content. The user had no visible indication that they could interrupt execution or that the terminal was still interactive.

2. **Plan/todo snapshots accumulated in scrollback.** Every `TodoUpdateEvent` appended a new "Plan:" block to terminal scrollback, causing duplicates that obscured the actual conversation flow.

### Pain Points

- Users had to know Ctrl+C existed as the only interrupt mechanism, with no on-screen hint.
- Ctrl+C exited the entire session rather than offering a chance to redirect the agent.
- The follow-up input prompt only appeared after the agent completed, making the terminal feel "locked" during execution.
- Multiple plan snapshots cluttered scrollback when the agent updated its todo list frequently.

## Solution

Introduced a three-tier approach:

1. **Persistent input bar**: The BubbleTea `View()` now composes transient content (spinner, streaming, approval, AI stream) above a permanent input bar with separator, providing a consistent visual anchor.

2. **Escape-to-interrupt**: A new `interruptCh` channel carries Esc keystrokes from the model to the event loop. On interrupt, the backend execution is cancelled and the renderer transitions to follow-up mode, allowing the user to redirect the agent with a new message. Ctrl+C retains its role as "exit session entirely."

3. **In-place plan updates**: `renderTodoUpdate` now scans backward for the most recent `kindTodoUpdate` in history. If found, it replaces the item and triggers a re-commit rather than appending a new block.

## Implementation Details

### New type: `inputBarMode`

```
inputBarHidden   — no input bar (CI, non-interactive, legacy path)
inputBarDisabled — visible but inactive ("esc to interrupt" hint)
inputBarActive   — text input focused (follow-up mode, cursor visible)
```

### Composed View layout

```
[transient content]                      (spinner/streaming/approval/AI)
  [-] Current task description           (optional: in_progress todo)
──────────────────────────── (full width)
> user input / esc to interrupt          (input area)
  enter send · ctrl+c exit               (hint, active mode only)
```

### Key changes by file

| File | Change |
|------|--------|
| `run_stream_inline_types.go` | `inputBarMode` enum, `interruptCh` in config |
| `run_stream_inline_bubbletea.go` | Model restructure, `renderComposedView`, `renderTransientContent`, `renderSeparatorLine`, `renderSpinnerLine`, `handleInputBarMode` |
| `run_stream_inline_keypress.go` | Esc → `interruptCh`, routing uses `inputBarMode` |
| `run_stream_inline.go` | `interruptCh` select case with interrupt-to-follow-up flow |
| `run_stream_inline_messages.go` | `inputBarModeMsg`, `currentTaskMsg` |
| `run_stream_inline_render.go` | `currentTask` extraction from `TodoUpdateEvent`, in-place plan history replacement |
| `run_stream_inline_followup.go` | "interrupted" phase eligibility, fix empty-input-with-followUpEnabled exit path |
| `run_stream.go`, `run_session.go` | Wire `interruptCh` through program startup and config |

### Backward compatibility

- The legacy path (BubbleTea without stdin ownership, non-TTY, CI) is untouched. When channels are nil, `inputBarMode` starts as `inputBarHidden` and the original flat `View()` switch handles rendering.
- All existing message types (`textInputStartMsg`, `textInputHideMsg`, `followUpShowMsg`, `followUpHideMsg`) continue to work; the text input handlers now transition `inputBarMode` instead of setting a boolean.

## Benefits

- **Always-visible interaction surface**: Users see "esc to interrupt" at all times during processing, making the terminal feel responsive and interactive.
- **Non-destructive interrupt**: Esc interrupts the agent and transitions to follow-up mode. The user can redirect without losing the session context.
- **Cleaner scrollback**: Plan/todo updates replace in-place rather than accumulating, reducing visual noise.
- **Current task at a glance**: The 1-line indicator shows what the agent is working on right now without consuming significant vertical space.

## Impact

- **End users**: Significantly improved interactive experience during long-running agent executions. The terminal no longer feels "locked" during processing.
- **CI/non-interactive**: Zero impact. The input bar is hidden and all legacy paths remain functional.
- **Test coverage**: All 40 relevant tests updated and passing. Cursor position tests adjusted for the new composed layout (Y offset changed from 2 to 1).

## Related Work

- [Branded Welcome Header with Recent Sessions](2026-03-05-231338-branded-welcome-header-with-recent-sessions.md) — session header panel
- [Follow-up History and Resumed Session BubbleTea](2026-03-05-082259-follow-up-history-and-resumed-session-bubbletea.md) — follow-up loop architecture
- [Ctrl+O Keybinding Full BubbleTea Stdin Ownership](2026-03-05-075631-ctrl-o-keybinding-full-bubbletea-stdin-ownership.md) — channel-based keystroke model
- [Unify Live vs Recommit Spacing](2026-03-06-193154-unify-live-vs-recommit-spacing.md) — recommit and history rendering

---

**Status**: ✅ Production Ready
**Timeline**: Single session
