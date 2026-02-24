# Fix Conversational Session UX in Execution TUI

**Date**: February 24, 2026

## Summary

Fixed the execution TUI to stop conflating execution-level phase with session-level state in conversational mode. The header and footer no longer display "completed" indicators when the user is expected to continue the conversation, removing a misleading UX signal that made sessions feel final.

## Problem Statement

When an execution finished inside a conversational session (e.g. `stigmer draft skill`), the TUI displayed:

- **Header**: `Session: ses-xxx  ✅ completed`
- **Footer**: `✅ Completed — Enter send  Esc exit`

### Pain Points

- Sessions don't have a "completed" status — they are open conversation threads. The "completed" label belongs to the execution (a single turn), not the session.
- "Completed" signals finality. In a conversational context the user should feel invited to continue, not that things are over.
- Double reinforcement: both header AND footer showed "completed" with a green checkmark, strongly suggesting the session was done.
- The same issue appeared when resuming a session via `stigmer run ses-xxx`, since `NewResumable` starts with `inputActive: true` and `phase: "completed"`.

## Solution

When in conversational mode (`FollowUpFn != nil`) and the input composer is active (`inputActive == true`), the TUI now:

- **Header**: Shows just `Session: ses-xxx` with no phase indicator.
- **Footer**: Shows just `Enter send  Esc exit` with no completion prefix.

The execution phase is an implementation detail of the just-completed turn. The viewport content (AI messages, error blocks, tool results) already tells the user what happened. The chrome should facilitate the next action, not repeat status.

## Implementation Details

Two surgical edits in `client-apps/cli/pkg/executiontui/view.go`:

**`renderHeader()`**: Added an `inputActive` check before the existing `SessionID`/`ExecutionID` branching. When `inputActive` is true, the phase indicator is omitted entirely.

**`renderFooter()`**: Removed the `doneFooterText(m.phase)` prefix from the `inputActive` case. The footer becomes purely action-oriented.

Both the live streaming path (`streamAgentExecution` → `New`) and the session resume path (`resumeSession` → `NewResumable`) benefit automatically, since both set `inputActive: true` when it's the user's turn.

Non-conversational mode (no `FollowUpFn`, `done == true`) is completely unaffected — `✅ Completed — q exit` remains correct there.

## Benefits

- Sessions feel conversational rather than terminal
- The UX correctly distinguishes "execution done, your turn" from "session over"
- No new state or fields — the fix leverages the existing `inputActive` flag
- Zero risk to non-conversational (single-execution) mode

## Impact

- **CLI users** running `stigmer draft skill`, `stigmer run <agent>`, or resuming sessions via `stigmer run ses-xxx` will see a cleaner, non-misleading header and footer when composing follow-up messages.
- **No backend changes** — sessions correctly have no status enum; this was purely a CLI rendering concern.

## Related Work

- Builds on the Phase 2 conversational session infrastructure (FollowUpFn, input composer, `NewResumable`)
- Related to prior streaming UX fixes in `2026-02-24-043603-fix-streaming-ux-and-protobuf-copy-semantics.md`

---

**Status**: ✅ Production Ready
