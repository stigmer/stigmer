---
name: Fix Session TUI UX
overview: Fix the execution TUI to stop showing "completed" status language when in conversational mode. The header and footer currently conflate execution phase with session state, making it feel like the session is done when the user is actually expected to continue the conversation.
todos:
  - id: fix-header
    content: Update renderHeader() in view.go to suppress phase indicator when inputActive is true
    status: completed
  - id: fix-footer
    content: Update renderFooter() in view.go to drop doneFooterText prefix when inputActive is true
    status: completed
  - id: verify-build
    content: Build the CLI and verify no compilation errors
    status: completed
  - id: manual-verify
    content: Verify the resumable path (NewResumable) also benefits from the fix without separate changes
    status: completed
isProject: false
---

# Fix Conversational Session UX in Execution TUI

## Problem

When an execution finishes inside a conversational session (e.g. `stigmer draft skill`), the TUI shows:

- **Header**: `Session: ses-xxx  ✅ completed`
- **Footer**: `✅ Completed — Enter send  Esc exit`

This is misleading because:

1. **Sessions don't have a "completed" status.** Sessions are open conversation threads. What completed is the *execution* (a single turn), not the session.
2. **"Completed" signals finality.** In a conversational context, the user should feel invited to continue, not that things are over.
3. **Double reinforcement.** Both header AND footer say "completed" with a green checkmark, strongly suggesting "we're done here."

The same problem occurs when resuming a session via `stigmer run ses-xxx` — the `NewResumable` model starts with `inputActive: true` and `phase: "completed"`, showing the same misleading indicators.

## Root Cause

The TUI renders `m.phase` (an *execution-level* concept) in the header and footer unconditionally, even when in conversational mode where `inputActive == true` and the user should be composing a follow-up. There is no distinction between "execution done, session over" and "execution done, your turn."

## Design Decision

When `inputActive` is true (conversational mode, user's turn to type), the TUI should:

- **Not display the execution phase** — it's an implementation detail of the just-completed turn, not the state of the conversation.
- **Show only the available actions** — "Enter send, Esc exit" is all the user needs.
- **Let the viewport content speak** — error blocks, AI messages, and tool results already tell the user what happened. The chrome should facilitate the next action, not repeat status.

This change is scoped to conversational mode only. Non-conversational mode (single-execution, no `FollowUpFn`) retains the current behavior unchanged — "✅ Completed — q exit" is correct and useful there.

## Proposed UX (before vs after)

**During execution (no change)**:

- Header: `Session: ses-xxx  ▶ in_progress`
- Footer: `↑↓ scroll  c cancel  ? help  q detach`

**After execution, user's turn (CHANGED)**:

- Header: `Session: ses-xxx` (phase indicator removed)
- Footer: `Enter send  Esc exit` (completion prefix removed)

**After execution, non-conversational mode (no change)**:

- Header: `Execution: exec-xxx  ✅ completed`
- Footer: `✅ Completed — ↑↓ scroll  q exit`

## Files to Modify

### 1. `[client-apps/cli/pkg/executiontui/view.go](client-apps/cli/pkg/executiontui/view.go)`

`**renderHeader()`** (line 66-89): When `m.inputActive` is true, render the header without a phase indicator. The session ID alone is sufficient — the active input composer visually communicates "your turn."

```go
// When input is active (user's turn in conversational mode), the session
// header stands alone — the phase of the last execution is irrelevant.
if m.inputActive {
    title = fmt.Sprintf("  Session: %s", m.cfg.SessionID)
} else if m.cfg.SessionID != "" {
    title = fmt.Sprintf("  Session: %s  %s", m.cfg.SessionID, phaseIndicator)
} else {
    title = fmt.Sprintf("  Execution: %s  %s", m.cfg.ExecutionID, phaseIndicator)
}
```

`**renderFooter()**` (line 104-139): When `m.inputActive` is true, drop the `doneFooterText()` prefix. The footer becomes action-only:

```go
case m.inputActive:
    hints = "  Enter send  Esc exit"
```

### 2. No other files need changes

- `model.go`: The textarea placeholder "Type a message, or press Esc to exit" is adequate and accurately describes the available actions.
- `handle_events.go`: The event handling logic (activating `inputActive` on `DoneEvent` when `FollowUpFn` is set) is correct.
- `input.go`: The input handling logic (Esc to exit, Enter to send) is correct.
- `followup.go`: The follow-up flow is correct.
- `replay.go`: `NewResumable` starts with `inputActive: true`, so it will automatically benefit from the header/footer fix without any changes.

## What We Are NOT Changing

- Execution phases during active execution (pending, in_progress, waiting_for_approval) — these are useful real-time feedback.
- Non-conversational mode UX (no `FollowUpFn`) — "✅ Completed — q exit" is correct there.
- The `done` footer path — that's for non-conversational exits and should keep showing the phase.
- Any backend or proto definitions — sessions correctly have no status enum; this is purely a CLI rendering fix.

