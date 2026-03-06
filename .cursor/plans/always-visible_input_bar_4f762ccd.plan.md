---
name: Always-Visible Input Bar
overview: Restructure the BubbleTea View to always show a persistent input bar at the bottom of the terminal, add Escape-to-interrupt during agent processing, and show a compact "current task" indicator from the plan/todo list -- replacing the current pattern where the follow-up prompt only appears after agent completion.
todos:
  - id: phase1-model
    content: "Restructure inlineBubbleModel: add inputBarMode enum, currentTask field, interruptCh; remove textInputActive/followUpActive booleans"
    status: completed
  - id: phase1-view
    content: "Rewrite View() as composed layout: transient content section + persistent input bar section"
    status: completed
  - id: phase1-escape
    content: "Add Escape-to-interrupt: new interruptCh, handleIdleKey Esc handling, event loop differentiation between interrupt and cancel"
    status: completed
  - id: phase1-messages
    content: Define new message types (inputBarModeMsg, currentTaskMsg); migrate from textInputStartMsg/textInputHideMsg/followUpShowMsg/followUpHideMsg
    status: completed
  - id: phase1-followup
    content: Rework follow-up activation to use inputBarMode transitions instead of separate textInput lifecycle
    status: completed
  - id: phase2-task-indicator
    content: Extract in_progress todo from TodoUpdateEvent, send currentTaskMsg, render 1-line indicator above input bar
    status: completed
  - id: phase2-plan-inplace
    content: "Smarter plan scrollback: use triggerReCommit to replace previous kindTodoUpdate in-place instead of appending"
    status: completed
  - id: phase3-approval
    content: Ensure approval menu composes correctly above the persistent input bar
    status: completed
  - id: phase3-streaming
    content: Ensure streaming (pre/post approval) composes correctly above the persistent input bar
    status: completed
  - id: phase3-edge-cases
    content: Handle CI/non-interactive mode (inputBarHidden), terminal resize, and height overflow
    status: completed
isProject: false
---

# Always-Visible Input Bar with Escape-to-Interrupt and Current Task Indicator

## Design Decision: Why NOT the full plan in the footer

The full plan can be 5-10 items (6-12 lines). Pinning it in the View region permanently would:

- Consume 15-30% of a typical 40-line terminal on every frame
- Shrink the scrollback area where the agent's actual work streams
- Create layout pressure during approvals (which also need View space)

**Proposed alternative:** A single-line "current task" indicator (the `in_progress` item only) above the input bar. The full plan stays in scrollback with smarter in-place updates when it changes.

---

## Current Architecture (what changes)

**Today's View() priority** (mutually exclusive):

```
textInputActive > approvalActive > streamingActive > followUpActive > aiStreamActive > spinner > empty
```

**Proposed View() composition** (layered, not exclusive):

```
[transient content area: spinner / streaming / approval / AI stream]
[current task indicator: 1-line in_progress todo, if any]
[separator line]
[input bar: disabled during processing, active during follow-up]
[hint line: "Esc to interrupt" or "enter send . ctrl+c exit"]
```

The key shift: View() goes from a flat `switch` to a **composed layout** with a persistent bottom section.

---

## Phase 1: Persistent Input Bar + Escape-to-Interrupt

### 1.1 Model changes in [run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go)

Add a new state field to `inlineBubbleModel`:

- `inputBarMode` enum: `inputBarDisabled` (during processing), `inputBarActive` (follow-up mode), `inputBarHidden` (edge cases like non-interactive)
- Remove `textInputActive` / `followUpActive` as separate booleans -- they become `inputBarMode` states
- Add `currentTask string` field for the 1-line in-progress todo

### 1.2 View() restructure in [run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go)

Replace the current flat `switch` with a composed layout:

```go
func (m inlineBubbleModel) View() tea.View {
    var sections []string

    // Section 1: transient content (same priority as today)
    if transient := m.renderTransientContent(); transient != "" {
        sections = append(sections, transient)
    }

    // Section 2: persistent input bar (always present unless hidden)
    if m.inputBarMode != inputBarHidden {
        sections = append(sections, m.renderInputBar())
    }

    content := strings.Join(sections, "\n")
    v := tea.NewView(content)
    // Position cursor in input bar when active
    if m.inputBarMode == inputBarActive {
        // cursor positioning logic
    }
    return v
}
```

`renderTransientContent()` handles the existing switch (approval, streaming, AI stream, spinner).

`renderInputBar()` renders:

- **Disabled mode**: separator + "Esc to interrupt" hint (dimmed)
- **Active mode**: separator + `>`  input + "enter send . ctrl+c exit" hint

### 1.3 Escape key handling in [run_stream_inline_keypress.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_keypress.go)

Today `handleIdleKey` only handles `ctrl+c`. Add:

```go
case "esc":
    if m.cancelCh != nil {
        select {
        case m.cancelCh <- struct{}{}:
        default:
        }
    }
```

Semantic distinction:

- **Esc**: interrupt agent processing (agent stops, user can type follow-up)
- **Ctrl+C**: exit session entirely

This requires changing the event loop in [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go) to differentiate between "interrupt" (transition to follow-up) and "cancel" (exit session). Today both go to `cancelCh`. We need two channels or a typed signal.

### 1.4 Event loop changes in [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)

- New `interruptCh` channel alongside existing `cancelCh`
- On interrupt: call `cancelExecFn()`, but instead of returning `renderResult{phase: "cancelled"}`, transition to follow-up mode (`activateFollowUp`)
- On cancel (Ctrl+C): current behavior (exit session)
- `activateFollowUp` sends a new `inputBarActivateMsg` instead of `textInputStartMsg`

### 1.5 Message types in [run_stream_inline_messages.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_messages.go)

New messages:

- `inputBarModeMsg{mode inputBarMode}` -- transitions the input bar state
- `currentTaskMsg{task string}` -- updates the current task indicator
- Deprecate `textInputStartMsg` / `textInputHideMsg` / `followUpShowMsg` / `followUpHideMsg` in favor of `inputBarModeMsg`

---

## Phase 2: Current Task Indicator

### 2.1 Propagate current task from plan/todo events

In [run_stream_inline_render.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_render.go), when `renderTodoUpdate` processes a `TodoUpdateEvent`:

- Find the first item with `status == "in_progress"`
- Send `currentTaskMsg{task: item.Content}` to the BubbleTea program
- If no in_progress item, send empty string (hides the indicator)

### 2.2 Render in input bar

In the `renderInputBar()` method, if `currentTask != ""`:

```
  [-] Setting up authentication module
──────────────────────────────────────
  Esc to interrupt
```

If empty, just show the separator + hint.

### 2.3 Smarter plan updates in scrollback

Currently each `TodoUpdateEvent` appends a new "Plan:" block to scrollback. Consider using `triggerReCommit` to replace the previous plan snapshot in-place (the history already tracks `kindTodoUpdate`). This prevents the scrollback from accumulating stale plan snapshots.

---

## Phase 3: Edge Cases and Polish

### 3.1 Approval co-existence

During approval, the approval menu needs View space. Layout:

```
[approval content + menu]
──────────────────────────────────────
  Esc to cancel
```

The input bar switches its hint contextually. The approval menu's own key handling (y/n/e/Esc) takes priority.

### 3.2 Streaming co-existence

During tool streaming (pre-approval progressive mode), the View shows streaming content above the input bar:

```
[streaming lines...]
──────────────────────────────────────
  Esc to interrupt
```

Post-approval streaming (header + content) similarly composes above the input bar.

### 3.3 Terminal resize

`tea.WindowSizeMsg` already updates `termWidth`. The separator line width adapts. No special handling needed.

### 3.4 Non-interactive / CI mode

When `followUpEnabled` is false (CI, non-session mode), set `inputBarMode = inputBarHidden`. No visible input bar. Behavior identical to today.

---

## Files to modify


| File                                                                                              | Change                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go) | Model restructure, View() composition, input bar rendering    |
| [run_stream_inline_keypress.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_keypress.go)   | Escape handling, key routing for inputBarMode                 |
| [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)                     | interruptCh, activateFollowUp changes, event loop             |
| [run_stream_inline_messages.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_messages.go)   | New message types, deprecate old ones                         |
| [run_stream_inline_render.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_render.go)       | currentTask extraction from TodoUpdateEvent                   |
| [run_stream_inline_followup.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_followup.go)   | Rework to use inputBarMode instead of separate textInput flow |
| [run_stream_inline_types.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_types.go)         | interruptCh in config, inputBarMode type                      |


---

## Risk assessment

- **Medium risk**: View() composition is the core change. If the transient content + input bar exceeds terminal height, BubbleTea's line management could behave unexpectedly. Mitigate by capping transient content height.
- **Low risk**: Escape key handling is straightforward.
- **Low risk**: Current task indicator is additive and isolated.
- **Testing**: Manual testing in different terminal sizes (small, large, wide, narrow) is critical. The re-commit logic must work correctly with the new composed View.

