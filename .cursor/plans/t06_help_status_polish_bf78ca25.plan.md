---
name: T06 Help Status Polish
overview: "Implement the final UX polish pass for the execution TUI: help overlay, spinner for pending phase, error block styling, and stay-open-after-completion behavior. Estimated ~200 net new lines across 3 new files and 6 modified files."
todos:
  - id: extract-handle-events
    content: Extract handleExecutionEvent, handleStreamClosed, refreshViewport from update.go into handle_events.go (pure refactor, run tests)
    status: completed
  - id: error-blocks
    content: Add blockError type in blocks.go, renderErrorContent in render_blocks.go, update handle_events.go to use error blocks for StreamErrorEvent and DoneEvent errors
    status: completed
  - id: stay-open-completion
    content: Change DoneEvent and streamClosedMsg to return nil cmd (stay open), fix phase bug, update footer to show done state message, update tests
    status: completed
  - id: help-screen
    content: Create help.go with renderHelp(), add showHelp field to model, add ?/esc key handlers in update.go, integrate help view in view.go, create help_test.go
    status: completed
  - id: spinner-pending
    content: Add spinner.Model field, initialize with spinner.Dot, handle spinner.TickMsg in Update, render spinner in header during pending phase
    status: completed
isProject: false
---

# T06: Help, Status Bar, and Polish

## Design Decisions (Confirmed)

### 1. Stay open after completion (approved above)

When `DoneEvent` arrives, the TUI no longer calls `tea.Quit`. Instead it stays interactive -- the user can scroll, expand/collapse, and browse at leisure. The footer shows `"Execution completed -- q to exit"`. Same for errors and `streamClosedMsg`.

**Bug fix bundled**: The current `DoneEvent` handler sets `m.phase = e.Phase` *before* calling `renderPhaseChange(e.Phase, m.phase)`, making the "previous" parameter wrong. Fix: capture old phase first.

### 2. Help as viewport replacement (not a composited overlay)

Pressing `?` sets `showHelp = true`. `View()` renders the help text in place of the viewport content (header and footer remain). The viewport `YOffset` is untouched, so scroll position is preserved when help is dismissed. `?` or `esc` dismisses. Standard pattern used by lazygit, k9s, etc.

### 3. Spinner only during "pending" phase

The `bubbles/spinner` component (braille dot style) replaces the static `"pending"` emoji in the header. The spinner tick command runs alongside the event listener. Once the phase changes away from `"pending"`, no more tick commands are issued.

### 4. Elapsed time counter -- deferred

Duration adds a continuous 1s ticker for the entire execution lifetime. The spinner already signals "alive" during pending, and streaming events keep the UI active during in_progress. Duration is shown in the post-exit summary. Deferring keeps T06 focused.

### 5. Error blocks -- distinct from system blocks

New `blockError` type with red styling, visually distinguishing errors from dimmed system messages. Used by `StreamErrorEvent` and `DoneEvent` with errors.

### 6. File extraction to stay under 250-line limit

`update.go` is currently 232 lines. T06 additions (help toggle, spinner tick, esc key, done behavior) would push it over. Extract `handleExecutionEvent` (81 lines) and `handleStreamClosed` (13 lines) into `handle_events.go`. This is a clean SRP split: keyboard/window handling vs event processing.

---

## File Changes

### New files

- `**help.go**` (~70 lines) -- `renderHelp(width, height int) string` renders a centered help panel with all keybindings grouped by context (Navigation, Tool Results, Approval, General). Pure function, no side effects.
- `**help_test.go**` (~50 lines) -- Tests that help text contains all expected sections and keybinding hints.
- `**handle_events.go**` (~110 lines) -- Extracted from `update.go`: `handleExecutionEvent`, `handleStreamClosed`, `refreshViewport`. Includes the DoneEvent bug fix and stay-open behavior.

### Modified files

- `**[model.go](client-apps/cli/pkg/executiontui/model.go)**` (114 -> ~135 lines)
  - Add `showHelp bool` field
  - Add `spinner spinner.Model` field
  - Initialize spinner in `New()` with `spinner.Dot` style
  - Update `Init()` to return `tea.Batch(listenForEvents, m.spinner.Tick)`
- `**update.go**` (232 -> ~165 lines after extraction)
  - Add `?` key handler: toggles `m.showHelp`
  - Add `esc` key handler: clears `showHelp` if active
  - When `showHelp` is true, all keys except `?`, `esc`, `q`, `ctrl+c` are ignored
  - Add `spinner.TickMsg` case in `Update()`: update spinner model, return next tick only while phase == "pending"
  - Remove `handleExecutionEvent`, `handleStreamClosed`, `refreshViewport` (moved to `handle_events.go`)
- `**[view.go](client-apps/cli/pkg/executiontui/view.go)**` (118 -> ~155 lines)
  - `View()`: when `showHelp`, render `renderHelp()` in place of viewport
  - `renderHeader()`: use `m.spinner.View()` instead of `phaseIcon()` when phase == "pending"
  - `renderFooter()`: add done state with phase-appropriate message ("Execution completed -- q to exit", "Execution failed -- q to exit")
  - Add `? help` hint to non-done footer states
- `**[blocks.go](client-apps/cli/pkg/executiontui/blocks.go)**` (111 -> ~125 lines)
  - Add `blockError blockType` constant
  - Add `newErrorBlock(content string) contentBlock` constructor
- `**[render_blocks.go](client-apps/cli/pkg/executiontui/render_blocks.go)**` (208 -> ~220 lines)
  - Add `errorStyle` (red foreground, bold)
  - Add `renderErrorContent(content string) string` function
- `**[update_test.go](client-apps/cli/pkg/executiontui/update_test.go)**` -- Update `TestUpdate_DoneEvent_SetsDone` to verify cmd is nil (not tea.Quit). Add tests for: help toggle via `?`, esc dismisses help, `?` during approval shows help, keys blocked during help, done footer text.

### Unchanged files

`events.go`, `messages.go`, `approval.go`, `render_approval.go`, `focus.go`, `scroll.go`, `scroll_test.go`, `doc.go`, `render_blocks_test.go`, `approval_test.go` -- no changes needed.

---

## Implementation Order

Each step is independently testable and committable:

1. **Extract `handle_events.go**` -- Pure refactor, zero behavior change. Run tests to verify.
2. **Error blocks** -- Add `blockError` type, `renderErrorContent`, update `handle_events.go` to use error blocks for `StreamErrorEvent` and `DoneEvent` errors.
3. **Stay open after completion** -- Modify `handleExecutionEvent` (DoneEvent) and `handleStreamClosed` to return nil cmd instead of tea.Quit. Fix the phase bug. Update footer for done state. Update tests.
4. **Help screen** -- Add `help.go`, `showHelp` field, `?`/`esc` key handlers, view integration. Add tests.
5. **Spinner** -- Add spinner field, initialize in New/Init, handle tick in Update, render in header. Smallest change, saved for last since it adds a new component dependency.

---

## Success Criteria (from T01 plan)

- Help overlay shows all keybindings clearly
- Status bar adapts to execution state (already done + spinner enhancement)
- Spinner during pending phase
- Errors visually distinct from normal content
- TUI stays open after completion for browsing
- All files under 250 lines
- All existing tests pass + new tests for each feature
- Build passes, vet clean

