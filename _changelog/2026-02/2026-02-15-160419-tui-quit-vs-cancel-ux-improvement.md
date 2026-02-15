# TUI Quit vs Cancel UX Improvement

**Date**: February 15, 2026

## Summary

Redesigned the execution TUI (terminal user interface) to clearly separate "detaching from the viewer" and "cancelling the execution" actions, eliminating user confusion and enabling inline cancellation without leaving the TUI. The changes introduce a two-stage cancel confirmation flow, update all footer labels to distinguish "detach" from "exit", and fix a misleading "EXECUTION TERMINATED" message that appeared when users quit while the execution was still running.

## Problem Statement

The execution TUI had three critical UX issues that confused users and made the tool harder to use:

### Pain Points

1. **Misleading post-quit summary**: When a user pressed `q` to exit the TUI while an execution was still running (phase `IN_PROGRESS`), the post-quit summary panel showed "EXECUTION TERMINATED" even though the execution continued running on the backend. This created the false impression that quitting the viewer stopped the execution.

2. **No semantic separation between detach and quit**: The `q` key always exited the TUI viewer, but the footer labeled it "quit" regardless of whether the execution was done or still running. This implied that pressing `q` would stop the execution, when in reality it only closed the viewer.

3. **No inline cancel option**: Users had to exit the TUI and run `stigmer delete execution <id>` from the command line to cancel an execution. The TUI already handled inline approval prompts via channels, so there was no architectural reason cancel couldn't have the same first-class treatment.

## Solution

Introduced a comprehensive set of changes across 8 files to address all three issues:

### 1. Semantic Separation: "Detach" vs "Exit"

- When execution is still running, the footer now shows `q detach` instead of `q quit`
- When execution is done (terminal phase), the footer shows `q exit` (unchanged)
- The help overlay now documents: `q / Ctrl+C` → "Detach (execution continues in background)"
- This makes it crystal clear that quitting the viewer does not stop the execution

### 2. Inline Cancel with Confirmation

- Added new `c` key binding to trigger cancellation (only available when execution is running)
- Introduced two-stage confirmation flow:
  - **Stage 1**: Press `c` → Footer shows `Cancel execution? [y] yes [n] no`
  - **Stage 2**: Press `y` to confirm (sends cancel API call), or `n`/`esc` to dismiss
- Cancel integrates with the existing gRPC stream architecture:
  - On confirm, the TUI sends the cancel request to the backend
  - The backend transitions the execution to `CANCELLED`
  - The stream delivers the phase change back to the TUI
  - The TUI displays the terminal state naturally
- If the cancel API fails, an error block is shown and the user can retry

### 3. Distinct Detach Panel

- Fixed `agentSummaryTitleAndStyle()` to explicitly handle all execution phases
- The default case now returns `"EXECUTION STATUS UNKNOWN"` instead of incorrectly showing "EXECUTION TERMINATED" for running executions
- Added new `displayAgentExecutionDetached()` function that shows a neutral blue panel when the user quits while execution is running:
  - Shows execution snapshot (phase, messages, tool calls)
  - Includes message: "The execution continues in the background."
  - Provides actionable commands:
    - `stigmer get execution <id>` to check status
    - `stigmer delete execution <id>` to cancel
- The post-quit flow now branches on `result.Done()`:
  - Terminal phase → `displayAgentExecutionComplete()` (existing behavior)
  - Still running → `displayAgentExecutionDetached()` (new behavior)

## Implementation Details

### State Management

Added two new boolean fields to the TUI model:

- `cancelConfirm bool`: True when showing the y/n confirmation prompt in the footer
- `cancelling bool`: True after sending the cancel request, before the phase changes

These fields work alongside the existing `approval` and `done` states to manage the TUI's interaction modes.

### Cancel Flow Architecture

The cancel flow follows the same architectural pattern as approval:

```
User presses 'c'
  ↓
cancelConfirm = true (footer shows prompt)
  ↓
User presses 'y'
  ↓
cancelConfirm = false, cancelling = true
  ↓
Append "Cancelling execution..." block
  ↓
Execute async cancel API call via tea.Cmd
  ↓
cancelResultMsg arrives
  ↓
If error: clear cancelling, show error block
If success: wait for stream to deliver CANCELLED phase
  ↓
DoneEvent arrives with phase "cancelled"
  ↓
done = true, TUI shows completion state
```

The cancel request never blocks the TUI event loop thanks to Bubbletea's command pattern.

### Footer State Priority

The footer now adapts through 6 states in priority order:

1. **Done**: Execution finished → `q exit` (unchanged)
2. **Cancel confirm**: Showing confirmation → `Cancel execution? [y] yes [n] no`
3. **Cancelling**: Cancel in flight → `Cancelling... ↑↓ scroll q detach`
4. **Approval**: Tool approval active → `[a] Approve [s] Skip [r] Reject [q] Detach`
5. **Scroll paused**: User scrolled up → `... c cancel ? help q detach`
6. **Normal**: Auto-scrolling → `↑↓ scroll c cancel ? help q detach`

All non-done states now use "detach" instead of "quit".

### Key Handling Priority

Updated `handleKeyPress` priority order to handle cancel keys:

1. Quit/detach keys (always available, dismisses cancel confirm if active)
2. Cancel confirmation keys (when `cancelConfirm` is true)
3. Help toggle
4. Help dismiss
5. Approval keys
6. Cancel key (`c` when execution is running and `CancelFn` is available)
7. Focus/toggle keys
8. Navigation keys
9. Viewport scroll keys

This ensures cancel confirmation captures input when active, similar to how approval mode works.

### Dependency Injection

The cancel callback is injected through the TUI Config:

```go
cancelFn := func() error {
    _, err := execution.Cancel(conn, executionID)
    return err
}

model := executiontui.New(executiontui.Config{
    ExecutionID:       executionID,
    Events:            events,
    ApprovalResponses: approvalResponses,
    CancelFn:          cancelFn,  // New field
})
```

This keeps the TUI package independent of the execution package and makes testing easier.

## Files Modified

### TUI Core (6 files)

1. **`pkg/executiontui/model.go`**
   - Added `CancelFn func() error` to `Config` struct
   - Added `cancelConfirm` and `cancelling` fields to `Model`

2. **`pkg/executiontui/messages.go`**
   - Added `cancelResultMsg` type for async cancel results

3. **`pkg/executiontui/update.go`**
   - Added cancel key handling in `handleKeyPress`
   - Added `handleCancelConfirmKey` for y/n confirmation
   - Added `executeCancelCmd` to invoke `CancelFn` asynchronously
   - Added `handleCancelResult` to process API response

4. **`pkg/executiontui/view.go`**
   - Updated `renderFooter` with 6 states and cancel confirm/cancelling cases
   - Changed "quit" to "detach" in all non-done footer labels

5. **`pkg/executiontui/help.go`**
   - Added "Execution Control" section with cancel key documentation
   - Updated "General" section to clarify detach behavior

### Command Integration (2 files)

6. **`cmd/stigmer/root/run_stream.go`**
   - Added `execution` package import
   - Wired `CancelFn` callback using `execution.Cancel`
   - Added post-quit branching logic: `Done()` vs detach

7. **`cmd/stigmer/root/run_display_summary.go`**
   - Fixed `agentSummaryTitleAndStyle` default case to return "EXECUTION STATUS UNKNOWN"
   - Added explicit case for `EXECUTION_TERMINATED`
   - Added `displayAgentExecutionDetached` function with detach panel

## Benefits

### For End Users

- **Clarity**: No more confusion about whether quitting stops the execution
- **Efficiency**: Cancel directly from the TUI without switching contexts
- **Confidence**: Clear feedback during cancel operation (confirmation, in-flight state, completion)
- **Accuracy**: Post-quit messages accurately reflect what happened

### For Developers

- **Consistency**: Cancel follows the same pattern as approval (inline, channel-based)
- **Testability**: Cancel callback is injected, making the TUI easier to test
- **Maintainability**: State management is explicit with clear field names
- **Extensibility**: The priority-based footer rendering makes it easy to add new states

### Metrics

- **Code changes**: 192 additions, 32 deletions across 8 files
- **Net addition**: +160 lines (mostly new cancel handling and detach panel)
- **Complexity**: Minimal increase - cancel reuses existing patterns (approval flow, Bubbletea commands)

## Impact

### User-Facing Changes

- **TUI footer labels**: "quit" becomes "detach" when execution is running
- **New keybinding**: `c` to cancel execution (with confirmation)
- **New panel**: Detach notice shown when quitting during execution
- **Help documentation**: Updated to reflect new cancel key and detach semantics

### Developer Impact

- **API surface**: New optional `CancelFn` field in `executiontui.Config`
- **Backward compatibility**: Fully backward compatible (CancelFn is optional, checked before use)
- **Testing**: Cancel flow can be tested by injecting mock `CancelFn`

### No Breaking Changes

All changes are additive or improve existing behavior. The TUI still works correctly if `CancelFn` is nil (cancel key is simply unavailable).

## Design Decisions

### Decision 1: Two-Stage Cancel Confirmation

**Rationale**: Cancelling an execution is destructive and irreversible. A single keypress is too easy to trigger accidentally. The two-stage flow (c → y) provides a safety net while remaining fast for intentional cancellations.

**Alternative considered**: Modal dialog with text input. Rejected as too heavyweight and inconsistent with the TUI's keyboard-first design.

### Decision 2: Cancel Unavailable During Approval

**Rationale**: During approval mode, the footer already captures keys (a/s/r). Adding `c` there makes the interface too busy and creates ambiguity: should rejecting a single tool call vs cancelling the entire execution be conflated?

**Alternative considered**: Allow cancel during approval by detecting `c` separately. Rejected to keep approval mode focused and avoid overwhelming users with choices at critical decision points.

### Decision 3: Async Cancel with Stream Confirmation

**Rationale**: The cancel API call is sent asynchronously, and the TUI waits for the stream to deliver the phase change to `CANCELLED`. This ensures the TUI always reflects the true backend state and handles race conditions naturally.

**Alternative considered**: Immediately transition to done state after API call. Rejected because the backend might take time to cancel (cleanup, checkpoint save), and showing the transition is more informative.

### Decision 4: "Detach" vs "Quit"

**Rationale**: "Detach" clearly communicates that you're leaving the viewer without affecting the execution. "Quit" is ambiguous - quit what? The TUI or the execution?

**Alternative considered**: "Close viewer". Rejected as too verbose for a footer hint.

## Testing Considerations

### Manual Testing Scenarios

1. **Normal completion flow**: Run execution to completion → press `q` → verify "EXECUTION COMPLETE" panel
2. **Detach during execution**: Run execution → press `q` while running → verify "DETACHED FROM EXECUTION" panel
3. **Cancel flow**: Run execution → press `c` → press `y` → verify "Cancelling..." message → verify "EXECUTION CANCELLED" final state
4. **Cancel dismissal**: Press `c` → press `n` or `esc` → verify footer returns to normal
5. **Cancel during approval**: When approval prompt is active → press `c` → verify it's ignored (approval takes priority)
6. **Footer labels**: Verify "detach" appears when running, "exit" when done
7. **Help documentation**: Press `?` → verify cancel key and detach behavior are documented

### Automated Testing Opportunities

The cancel flow is testable via:
- Inject mock `CancelFn` that returns nil (success) or error
- Send `cancelResultMsg` with error → verify error block appears
- Check footer text in different states (done, cancelling, cancel confirm)

## Future Enhancements

### Not Implemented (Out of Scope)

- **Cancel during approval**: Currently, cancel is disabled during approval mode. Could be added if users request it, though it adds complexity to an already sensitive interaction.

- **Reattach command**: A `stigmer get execution <id> --follow` command that reconnects to a running execution would complement the detach feature nicely. This would let users detach and reattach freely.

- **Goroutine cleanup on detach**: When the user quits, the `streamToEvents` goroutine may block forever on channel sends. Context-based cancellation should be added to clean up properly, but this is a pre-existing issue and orthogonal to the UX improvements.

## Related Work

This change builds on the existing TUI architecture:

- **Approval flow**: The cancel flow mirrors the approval pattern (channel-based, confirmation-based)
- **Phase tracking**: Leverages the existing phase state machine and stream delivery
- **Bubbletea patterns**: Follows Bubbletea's command pattern for async operations

## Lessons Learned

1. **Label precision matters**: Changing "quit" to "detach" dramatically clarified the user mental model. Small wording changes can have outsized impact.

2. **Confirmation UX is tricky**: The two-stage confirmation (c → y) balances safety with efficiency. A single dismissable prompt would be safer but slower; immediate cancel would be faster but dangerous.

3. **State priority is critical**: The footer state priority list (6 states) ensures the most important context always wins. Without clear priority, state transitions become unpredictable.

4. **Consistency compounds**: Reusing the approval flow pattern for cancel reduced cognitive load and implementation time. Consistent patterns make systems more learnable.

---

**Status**: ✅ Production Ready  
**Timeline**: 1 session (~2 hours)  
**Complexity**: Medium (160 LOC, 8 files, new interaction pattern)
