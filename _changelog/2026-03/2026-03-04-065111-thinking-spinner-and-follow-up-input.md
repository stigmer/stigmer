# Thinking Spinner and Follow-Up Input for Inline CLI

**Date**: March 4, 2026

## Summary

Added two inline renderer features that eliminate "is it frozen?" anxiety during agent reasoning gaps and enable multi-turn conversations without re-running the command. A thinking spinner appears after 2 seconds of inactivity, and a follow-up prompt lets users continue the conversation after execution completes.

## Problem Statement

The inline CLI renderer had two UX gaps compared to the alt-screen TUI:

### Pain Points

- When the agent reasons between tool calls, the inline renderer shows nothing — users cannot distinguish "thinking" from "frozen"
- After the agent completes, the inline renderer exits immediately — users must re-run the full command to continue the conversation
- The TUI handles both: a 2-second idle threshold shows "Thinking..." in the header, and the input composer activates for follow-ups

## Solution

Two independent features integrated into the inline renderer event loop:

**Phase 4.0 — Thinking Spinner**: Reuse the existing `pkg/spinner.Spinner` on stderr. A 2-second idle timer fires when no events arrive during `in_progress` phase. The spinner is cleared synchronously before any event output, preventing interleaving.

**Phase 4.1 — Follow-Up Loop**: Wrap `renderInline` in an outer conversational loop. After `DoneEvent`, prompt for input via `bufio.Scanner` in cooked mode (zero new dependencies). Create a follow-up execution via the existing `buildFollowUpFn` and loop back into `renderInline` with new channels.

## Implementation Details

### Thinking Spinner (`run_stream_inline_spinner.go`)

Four methods on `inlineRenderer`:

- `thinkingAllowed()` — state predicate: phase is `in_progress`, no AI stream, no tool stream, no approval pending
- `startThinkingSpinner()` — guarded `spinner.Start("Thinking...")`
- `stopThinkingSpinner()` — synchronous `spinner.Stop()` before any event output
- `resetThinkTimer()` — resets 2s timer when allowed, stops otherwise

Event loop integration: third `select` case in `renderInline` for the timer channel. Timer stopped and spinner cleared on every event arrival; timer reset after every non-terminal event.

### Follow-Up Loop (`run_stream_inline_followup.go`)

- `runInlineFollowUpLoop` — outer loop: `renderInline` → eligible? → prompt → `followUpFn` → swap channels → repeat
- `readFollowUpInput` — `\n> ` prompt on stderr, `bufio.Scanner` on stdin, returns trimmed input
- `isFollowUpEligible` — gates on `completed`/`failed` phases with no exit error (failed allows corrective follow-up)

Both entry points wired: `streamAgentInline` (live sessions with `orgID` passthrough) and `resumeSession` inline path (replayed history).

## Benefits

- **No "is it frozen?" anxiety**: Spinner provides visual feedback during agent reasoning gaps, matching TUI behavior
- **Multi-turn conversations**: Users can continue interacting without re-running the command or losing context
- **Zero new dependencies**: `bufio.Scanner` in cooked mode leverages OS-native line editing; spinner reuses existing `pkg/spinner`
- **No raw mode conflicts**: Cooked mode for follow-up input avoids any interaction with `InlinePrompter`'s raw mode during approval

## Impact

- **Users**: Both live sessions (`stigmer run agent`) and resumed sessions (`stigmer run ses-xxx`) now support inline follow-up, matching the TUI's conversational experience
- **Architecture**: Clean separation — spinner methods in dedicated file, follow-up loop as outer wrapper, event loop internals unchanged
- **Test coverage**: 30 new tests (14 spinner state machine + 16 follow-up loop/input/eligibility)

## Related Work

- Follows Phase 3 (Claude Code-Style Approval Flow) which established the inline renderer's event handling patterns
- Spinner reuses `pkg/spinner` from the preparation phase spinner (Phase 2.4)
- Follow-up loop mirrors the TUI's `FollowUpFn` / `handleFollowUpStarted` pattern but without Bubbletea
- Precedes Phase 5 (Quick Cleanups) which addresses todo index reset, duplicate code, and orphaned functions

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
