# Fix TUI Viewport Scrolling During Input Composer Mode

**Date**: February 24, 2026

## Summary

Fixed a bug where the user could not scroll through agent output after execution completed in the CLI's conversational TUI. Arrow keys and Page Up/Down were being captured by the single-line textarea input composer, preventing viewport navigation entirely. The fix forwards scroll-related keys to the viewport when the input composer is active.

## Problem Statement

After an agent execution completes in a session, the TUI activates the input composer — a single-line textarea with the placeholder "Type a message, or press Esc to exit." At this point, the user is unable to scroll up through the agent's output to review earlier content.

### Pain Points

- Arrow Up/Down, Page Up/Page Down keys are swallowed by the textarea component
- No way to review long agent output after execution finishes
- Users must either read everything during streaming or lose access to earlier content
- Footer hints only show "Enter send  Esc exit" with no indication that scrolling should be available

## Solution

Intercept scroll-related key types (`KeyUp`, `KeyDown`, `KeyPgUp`, `KeyPgDown`) in the input key handler and forward them to the viewport instead of the textarea. Since the textarea is single-line, these keys serve no purpose there. Updated footer hints to show scroll availability.

## Implementation Details

### Key Dispatch Change (`input.go`)

Added a new case in `handleInputKey` that catches vertical navigation keys before they reach the textarea's default handler:

```go
case tea.KeyUp, tea.KeyDown, tea.KeyPgUp, tea.KeyPgDown:
    var cmd tea.Cmd
    m.viewport, cmd = m.viewport.Update(msg)
    m.autoScroll = m.viewport.AtBottom()
    return m, cmd
```

This follows the same pattern used in `handleNavigationKey` for viewport scroll forwarding, maintaining consistency with how scroll state (`autoScroll`) is tracked throughout the TUI.

### Footer Hint Update (`view.go`)

Updated the `inputActive` footer from:
```
Enter send  Esc exit
```
to:
```
↑↓ scroll  Enter send  Esc exit
```

This matches the existing pattern where scroll hints appear in other TUI states (done, cancelling, normal operation).

### Design Decisions

- **Only vertical navigation keys are intercepted**: Left/Right arrows, Home/End, and all printable characters continue to flow to the textarea for normal text editing
- **No conflict with textarea functionality**: A single-line textarea has no use for Up/Down or Page Up/Down — these keys are no-ops in that context
- **Auto-scroll state is preserved**: After a scroll key is processed, `autoScroll` syncs with `viewport.AtBottom()`, consistent with all other scroll handlers in the TUI

## Benefits

- Users can freely scroll through the full agent transcript while deciding what follow-up to send
- No loss of functionality in the textarea — text editing works identically
- Consistent with scroll behavior in all other TUI states (running, approval, done)
- Footer hints now correctly advertise scrolling capability

## Impact

- **CLI users**: All users of `stigmer agent run` and `stigmer session` in conversational mode can now scroll after execution completes
- **Files changed**: 2 (`input.go`, `view.go` in `executiontui` package)
- **Risk**: Minimal — no behavioral change for text input; only redirects previously wasted keystrokes

## Related Work

- `2026-02-15-120409-cli-tui-scroll-navigation.md` — Initial scroll navigation implementation
- `2026-02-19-021633-phase2-conversational-tui.md` — Phase 2 conversational mode (introduced the input composer)
- `2026-02-24-150814-fix-conversational-session-ux.md` — Earlier conversational UX fixes

---

**Status**: ✅ Production Ready
