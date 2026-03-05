# Fix Duplicate Session Header on Subject Update

**Date**: March 5, 2026

## Summary

Eliminated duplicate session header panels that appeared in terminal scrollback when the backend resolved the session subject. The previous fix consolidated header rendering into Bubbletea and relied on ClearScreen + Println to update the header in-place. However, `tea.ClearScreen` (`\033[2J`) in modern terminals moves visible content to the scrollback buffer rather than erasing it, so the old header and content remained in scrollback while the re-rendered version appeared on the fresh screen. The fix removes the automatic re-commit on subject arrival, keeping the subject update silent until the next user-initiated re-commit (Ctrl+O) or session resume.

## Problem Statement

When starting a new agent session, the CLI displayed two separate header panels: one without the subject (rendered immediately) and one with the subject (rendered 3-6 seconds later via re-commit). Users saw duplicate, conflicting headers in the terminal scrollback.

### Root Cause (Revised)

The earlier fix (same date, earlier commit) correctly eliminated the dual-write path where `renderSessionHeader(os.Stderr, ...)` was called alongside the Bubbletea-based inline header. However, the ClearScreen-based re-commit mechanism itself was the remaining source of duplication.

When `triggerReCommit()` fired on subject arrival:

1. `tea.ClearScreen` sent `\033[2J\033[1;1H`
2. In modern terminals (iTerm2, macOS Terminal, etc.), `\033[2J` **moves visible content to the scrollback buffer** -- it does not erase it
3. `tea.Println(rendered)` re-printed the full history (with updated header) on the now-blank screen
4. Result: old header + old content persisted in scrollback, followed by new header + full content on screen

This is a terminal limitation, not a Bubbletea bug. The only escape that clears scrollback (`\033[3J`) would destroy ALL terminal history, not just Stigmer's output.

### Pain Points

- **Duplicate headers**: Two bordered panels with different content visible in scrollback
- **Duplicated content**: All AI messages and tool results repeated below the new header
- **Terminal limitation**: `\033[2J` preserves scrollback in all modern terminals -- ClearScreen cannot erase previously-committed inline content

## Solution

Remove the `triggerReCommit()` call from the subject update path. The subject is still stored in `history[0].header.Subject` (via pointer mutation), so it is available for:

- **Ctrl+O re-commit**: User-initiated re-commit renders the updated header with subject
- **Session resume**: History carries the resolved subject across executions
- **Follow-up loop**: The header in history[0] reflects the subject for subsequent renderings

### Changes (1 file)

- **`run_stream_inline.go`**: Removed `r.triggerReCommit()` from the `subjectUpdate` case branch. The `history[0].header.Subject = subject` assignment is preserved.

### Prior changes retained

All changes from the earlier fix remain in place and are correct:

- **`run_agent_exec.go`**: `renderSessionHeader` confined to `if input.Detach` block
- **`run_session.go`**: `renderSessionHeader` confined to JSON branch of `resumeSession`
- **`run_stream.go`**: `renderSessionHeader` confined to JSON branch of `streamAgentExecution`
- **`run_stream_inline.go`**: Header rendered at startup via `statusf` through Bubbletea
- **`run_stream_inline_history.go`**: Blank-line gap after `kindHeader` in `renderHistoryBatch`

### Test impact

No test changes required. No existing tests assert that subject arrival triggers a re-commit. All 47 related tests pass unchanged.

## Benefits

- **No duplicate headers or content**: Subject update is silent -- no ClearScreen, no re-render
- **Subject preserved in history**: Available for Ctrl+O, resume, and follow-up renderings
- **Minimal change**: Single line removed, zero architectural risk
- **ClearScreen reserved for user-initiated actions**: Ctrl+O re-commit still uses ClearScreen, which is acceptable because the user explicitly triggered it

## Impact

- **Users**: No more duplicate header panels or repeated content in terminal scrollback. Subject silently enriches the header metadata for future renderings.
- **Ctrl+O**: Unchanged -- user-initiated re-commit still renders the header with subject via ClearScreen + Println. Scrollback duplication from Ctrl+O is accepted as an explicit user action.
- **Detach mode**: Unchanged -- still renders header via `renderSessionHeader` since no inline renderer runs.
- **JSON mode**: Unchanged -- header still renders on stderr for context.
- **Non-TTY / CI**: Unchanged -- header prints once at startup. Subject updates silently update history.

## Architectural Note

The Ctrl+O expand/collapse toggle also uses `triggerReCommit()` and produces the same scrollback duplication. This is accepted because it is user-initiated. Addressing it would require a fundamentally different rendering model (alt-screen, virtual terminal emulation) and is tracked separately.

## Related Work

- [Event history retention and subject update](2026-03-05-070144-event-history-retention-and-subject-update.md) -- Phase 1: introduced the re-commit mechanism and history[0] header storage
- [Re-commit performance optimization](2026-03-05-083840-re-commit-performance-optimization.md) -- Phase 5: batched re-commit into single Println
- [CLI session header subject enrichment](2026-03-04-111351-cli-session-header-subject-model-enrichment.md) -- Added subject polling

---

**Status**: Production Ready
**Timeline**: ~30 minutes
