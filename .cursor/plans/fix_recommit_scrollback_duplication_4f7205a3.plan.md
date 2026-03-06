---
name: Fix recommit scrollback duplication
overview: Fix the scrollback duplication bug where old content survives a recommit because Bubbletea v2's ClearScreen/Println sequence has a fundamental timing flaw -- clearScreen() only marks internal state without writing to the terminal, while insertAbove() runs with stale state.
todos:
  - id: analyze-raw-inline
    content: Verify tea.Raw + ClearScreen behavior in inline mode by reading ultraviolet TerminalRenderer to confirm relative cursor positioning works correctly after Raw writes
    status: completed
  - id: rewrite-recommit-cmd
    content: Rewrite buildReCommitCmd in run_stream_inline_history.go to use tea.Raw for clear+content and tea.ClearScreen for state reset
    status: completed
  - id: update-handle-recommit
    content: Update handleReCommit in run_stream_inline_bubbletea.go to clear model active states before returning the Cmd
    status: completed
  - id: debounce-recommit
    content: Refactor the select loop in run_stream_inline.go to coalesce multiple recommit triggers into one call
    status: completed
  - id: update-approval-recommit
    content: Update approval handlers that use buildReCommitCmd (handleApprovalStart, handleApprovalShow) for the new signature
    status: completed
  - id: test-and-verify
    content: Run unit tests and manually verify with the onboarding script that produced the screenshot bug
    status: completed
isProject: false
---

# Fix Recommit Scrollback Duplication

## Root Cause Analysis

After tracing through Bubbletea v2's source code (`cursed_renderer.go`, `tea.go`), the root cause is a **fundamental timing flaw** in the `tea.Sequence(tea.ClearScreen, tea.Println(...))` pattern used by `buildReCommitCmd`.

### The Flaw in Detail

**Step 1 -- `clearScreen()` does NOT write to the terminal:**

```699:756:charm.land/bubbletea/v2@v2.0.1/cursed_renderer.go
// clearScreen -- only marks internal state
func (s *cursedRenderer) clearScreen() {
    s.mu.Lock()
    s.scr.MoveTo(0, 0)  // internal cursor only
    s.scr.Erase()        // marks for redraw -- no terminal write
    s.mu.Unlock()
}
```

The actual `\033[2J` (clear visible screen) is deferred until `flush()` runs on the **next timer tick** (~16ms later).

**Step 2 -- `insertAbove()` writes DIRECTLY to the terminal using stale state:**

```699:756:charm.land/bubbletea/v2@v2.0.1/cursed_renderer.go
func (s *cursedRenderer) insertAbove(str string) error {
    // ...
    w, h := s.cellbuf.Width(), s.cellbuf.Height()  // STALE from last flush
    _, y := s.scr.Position()                         // (0,0) from clearScreen
    // ... calculates scroll offsets using stale h ...
    _, err := io.WriteString(s.w, sb.String())       // writes directly to terminal
}
```

**Step 3 -- `flush()` runs on the timer, AFTER insertAbove already wrote:**

```1394:1396:charm.land/bubbletea/v2@v2.0.1/tea.go
case <-p.ticker.C:
    _ = p.flush()              // writes program outputBuf
    _ = p.renderer.flush(false) // renders cellbuf -- happens LAST
```

**The net effect**: `insertAbove` runs on the **old terminal state** (screen not yet cleared) with **stale cellbuf dimensions**. Its scroll calculations push old content into scrollback. The embedded `\033[3J` erases scrollback, but the deferred `flush()` then re-renders and can leave artifacts depending on the stale-vs-actual state desync.

### Secondary Issue: No Debouncing of Recommit Triggers

Subject update and recent sessions can both fire in rapid succession, each calling `triggerReCommit()`. Two `reCommitMsg` messages enter the Bubbletea event loop. Since `execSequenceMsg` runs in a separate goroutine and sends messages back via `p.Send()`, the ClearScreen/Println pairs from both recommits can interleave with each other and with other `printLineMessage` events on the channel.

## Proposed Fix

### Approach: Use `tea.Raw()` + `tea.ClearScreen` instead of `tea.ClearScreen` + `tea.Println`

Bubbletea v2 provides `tea.Raw()` which writes escape sequences to `p.outputBuf`. This buffer is flushed by `p.flush()` **before** `p.renderer.flush()` on each timer tick -- guaranteeing the clear sequences and content reach the terminal before the renderer tries to render the View.

**New `buildReCommitCmd`:**

Replace the current `tea.Sequence(tea.ClearScreen, tea.Println(eraseScrollback + rendered))` with `tea.Sequence(tea.Raw(clearAndContent), tea.ClearScreen)`:

- `tea.Raw("\033[2J\033[1;1H\033[3J" + rendered + "\n")` -- atomically writes clear sequences + content to the output buffer. On the next tick, `p.flush()` writes it ALL to the terminal before the renderer touches anything.
- `tea.ClearScreen` -- follows the Raw, resets the renderer's internal state (cursor position, erase flag) so the subsequent `flush()` does a clean View redraw at the correct position.

This approach:

1. Eliminates the timing gap between clear and content write
2. Bypasses `insertAbove` entirely, removing the stale-cellbuf problem
3. Uses only documented Bubbletea v2 APIs

### Debounce Multiple Recommit Triggers

Coalesce subject update and recent sessions updates that arrive within the same `select` iteration. Instead of calling `triggerReCommit()` from each select case independently, set a `recommitNeeded` flag and call `triggerReCommit()` once after the select.

## Files to Change

- `**[run_stream_inline_history.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_history.go)`** -- Rewrite `buildReCommitCmd` to use `tea.Raw` + `tea.ClearScreen`; remove `eraseScrollback` constant
- `**[run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go)`** -- Update `handleReCommit` to clear model active states (streaming, approval, aiStream) before returning the Cmd, ensuring View() returns "" when the renderer next flushes
- `**[run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)**` -- Refactor the `select` loop to debounce multiple recommit triggers into a single `triggerReCommit()` call
- `**[run_stream_inline_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go)**` -- Update `handleApprovalStart`/`handleApprovalShow` to use the new `buildReCommitCmd` (they call it when `reCommitPayload` is non-empty)
- `**[run_stream_inline_messages.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_messages.go)**` -- Add `reCommitDoneMsg` type if needed for post-recommit state recovery

## Verification

- Manually test with the onboarding script (`agent-fleet/tools/00_onboard-planton-mcp-server.sh`) that triggered the bug in the screenshot
- Verify: (1) no duplicates when scrolling up after recommit, (2) Ctrl+O toggle still works, (3) approval collapse recommit works, (4) follow-up prompt recommit works
- Run existing unit tests (`go test ./client-apps/cli/cmd/stigmer/root/...`)

## Risk Assessment

- `**tea.Raw` behavioral verification needed**: The `Raw` approach is sound based on the Bubbletea v2 source analysis, but the interaction between `Raw` output and the renderer's relative-cursor mode in inline mode needs live verification. If the renderer's View ends up at the wrong position after the recommit, we may need to also send explicit cursor positioning as part of the Raw payload.
- `**ClearScreen` after `Raw` ordering**: Per `execSequenceMsg`, both messages are sent to `p.msgs` in order. But between them, other messages could interleave. The `ClearScreen` is only for resetting renderer state, so interleaving is acceptable -- the clear sequences already wrote to the terminal via `Raw`.

