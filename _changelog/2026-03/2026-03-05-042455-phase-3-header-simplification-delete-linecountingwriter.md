# Phase 3: Header Simplification -- Delete lineCountingWriter and Subject Update Mechanism

**Date**: March 5, 2026

## Summary

Deleted the entire in-place subject update mechanism (`lineCountingWriter`, `subjectUpdater`, ANSI cursor math) from the inline renderer. New sessions render the header without the Subject field; session resume shows it when already resolved. This eliminates the root cause of terminal wrapping bugs in the header path and removes 362 lines of fragile cursor tracking code.

## Problem Statement

The `lineCountingWriter` counted `\n` bytes to track terminal rows for cursor repositioning. When terminal soft-wrapping occurred (display rows added without `\n`), the counter drifted and the ANSI cursor-back operations (`\033[s`, `\033[u`, `\033[%dA`, `\033[2K`) hit the wrong row. This was the fundamental bug motivating the Bubbletea migration project.

### Pain Points

- `lineCountingWriter` wrapped both stdout and stderr to count newlines across all output, adding indirection to every write
- `subjectUpdater` used raw ANSI escape sequences for cursor save/restore -- fragile and terminal-dependent
- `pollSessionSubject` ran a background goroutine polling the backend every 2s for up to 30s
- `setupSubjectUpdater` wired all of the above together, wrapping the raw writers before passing to the streaming pipeline
- All of this complexity served a single cosmetic feature: replacing "Subject: --" with the auto-generated session title

## Solution

Removed the Subject field from the initial session header (new sessions). The `formatSessionHeaderContent` function already skips empty fields, so omitting `Subject` from the `sessionHeaderInfo` struct literal produces a clean header without a placeholder dash. On session resume, the subject is already resolved from the backend and renders normally.

## Implementation Details

- **`run_agent_exec.go`**: Removed `Subject: subjectPlaceholder` from headerInfo, deleted `setupSubjectUpdater` call and writer wrapping, deleted `pollSessionSubject` goroutine and its context, changed `streamAgentExecution` to receive raw `os.Stdout, os.Stderr`. Removed unused `"context"` import.
- **`run_stream_inline_header_update.go`**: Deleted entirely (176 lines). Contained `lineCountingWriter`, `subjectUpdater`, `setupSubjectUpdater`, `pollSessionSubject`, `renderSubjectPanelRow`, `subjectLineOffset`, and all constants.
- **`run_stream_inline_header_update_test.go`**: Deleted entirely (175 lines). All 11 tests tested deleted code.

## Benefits

- **362 lines deleted, 1 line added**: Net removal of complexity
- **No more writer wrapping**: stdout and stderr flow directly to the streaming pipeline without `lineCountingWriter` interposition
- **No background goroutine**: `pollSessionSubject` eliminated -- one fewer concurrent goroutine during execution
- **Terminal wrapping bug eliminated in header path**: The `lineCountingWriter` drift that caused misaligned cursor movement is gone

## Impact

- **New sessions**: Header panel no longer shows "Subject: --". Subject field is simply absent until session resume.
- **Session resume**: Unchanged. Subject appears as before (resolved from backend).
- **Bubbletea model**: Untouched. No changes to `inlineBubbleModel`, `View()`, or spinner rendering.
- **Event loop**: Untouched. `renderInline`, `handleEvent`, `statusf` routing unchanged.
- **JSON output mode**: Untouched. Separate code path.

## Architectural Discovery

Phase 3 of the T01 plan originally described "Move session header into View()". During planning, we discovered this is not viable: Bubbletea's `View()` renders at the bottom of output, while `Println()` commits content above it. Putting the header in `View()` would invert the display order. The header is committed top-of-session content and should remain so. A design decision document (`002-header-stays-committed.md`) captures this finding for the project.

## Related Work

- Phase 1: Bubbletea Program Shell (commit `0f9dfcf1`)
- Phase 2: Spinner Migration to Bubbletea View() (commit `0bb34b20`)
- Phase 4 (next): Approval Flow Migration -- move blocking approval into Bubbletea's event-driven Update cycle
- Design Decision 001: Conservative Bubbletea Integration Strategy

---

**Status**: Production Ready
**Timeline**: Phase 3 of incremental Bubbletea migration
