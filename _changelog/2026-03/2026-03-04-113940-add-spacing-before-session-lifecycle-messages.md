# Add Visual Spacing Before Session Lifecycle Messages

**Date**: March 4, 2026

## Summary

Added blank-line separators between streamed agent content and the session lifecycle messages that appear when a session ends (via Esc, completion, failure, or detach). This brings the session exit path into visual consistency with the non-session `displayAgentExecutionComplete` panel, which already emits leading/trailing blank lines.

## Problem Statement

When a user pressed Escape at an approval prompt to exit a session, the lifecycle messages ("Session ended by user", "Resume later with: ...", "Session ... exited (...)") rendered immediately after the last line of agent content with no visual break, making it hard to distinguish agent output from CLI chrome.

### Pain Points

- "Session ended by user" ran directly into the tail of the agent's streamed text
- The final status line ("Session ... exited (waiting_for_approval)") also appeared without separation
- The non-session equivalent (`displayAgentExecutionComplete`) already had proper spacing, so this was an inconsistency

## Solution

Insert a blank line before each group of session lifecycle messages, matching the pattern already established by `displayAgentExecutionComplete`.

## Implementation Details

Three single-line changes across two files:

1. **`handleSessionExit`** (`run_stream_inline_approval.go`): Prefixed `\n` to the "Session ended by user" `statusf` call, creating a blank line between agent content and the exit notice on stderr.
2. **`displaySessionExitLine`** (`run_display_summary.go`): Added `fmt.Println()` before the phase switch, inserting a blank line on stdout before the final status line for all session exit paths (completed, failed, cancelled, terminated, and catch-all).
3. **`displaySessionDetachLine`** (`run_display_summary.go`): Added `fmt.Println()` before the "Detached from ..." message for consistent treatment when detaching from a running session.

## Benefits

- Clear visual boundary between agent output and CLI lifecycle messages
- Consistent spacing across all session exit paths (user-exit, completion, failure, detach)
- Aligns with the existing spacing pattern in `displayAgentExecutionComplete`

## Impact

All CLI users running sessions (`stigmer run`) see improved readability when a session ends, regardless of how it ends.

## Related Work

- [CLI Approval Prompt Session Exit](2026-03-04-101639-cli-approval-prompt-session-exit.md) — introduced the Esc-to-exit flow that surfaces these messages

---

**Status**: ✅ Production Ready
