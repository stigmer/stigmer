# Fix Duplicate Session Header on Subject Update

**Date**: March 5, 2026

## Summary

Eliminated the dual-write architecture that caused duplicate session header panels when the backend resolved the session subject. The header now renders exclusively through Bubbletea, enabling the existing re-commit mechanism (ClearScreen + Println) to update it in-place when the subject arrives. Also fixed a spacing inconsistency between the initial header render and re-committed output.

## Problem Statement

When starting a new agent session, the CLI displayed two separate header panels: one without the subject (rendered immediately) and one with the subject (rendered 3-6 seconds later via re-commit). Users saw duplicate, conflicting headers in the terminal scrollback.

### Pain Points

- **Duplicate headers**: Two bordered panels with different content visible in scrollback
- **Spacing drift**: The initial header had a blank line gap after the panel (`\n\n`), but the re-committed header lacked it, causing content to visually shift on subject update
- **Architectural confusion**: The header was written directly to stderr by the caller (bypassing Bubbletea), while the re-commit mechanism relied on Bubbletea's ClearScreen to erase it -- an impossible combination once content scrolled into terminal scrollback

## Solution

Single-source header rendering through Bubbletea. The `renderSessionHeader(os.Stderr, ...)` calls were removed from the inline rendering path. Instead, `renderInline` prints the header at startup via `statusf` (which routes through Bubbletea's `Println`), placing the header within Bubbletea's line tracking. When the subject arrives, the existing `triggerReCommit()` mechanism fires ClearScreen + Println, replacing the header and all content with the updated version.

## Implementation Details

### Caller changes (3 files)

- **`run_agent_exec.go`**: Moved `renderSessionHeader` inside the `if input.Detach` block. Inline mode no longer calls it.
- **`run_session.go`**: Removed the unconditional `renderSessionHeader` from `openSession`. Added it to the JSON branch of `resumeSession` so JSON mode still gets the header on stderr.
- **`run_stream.go`**: Added `renderSessionHeader` to the JSON branch of `streamAgentExecution`.

### Renderer changes (2 files)

- **`run_stream_inline.go`**: At `renderInline` startup, when `initialHistory` is empty (new session), the header is printed via `statusf` through Bubbletea. Two calls produce the header panel followed by a blank line gap.
- **`run_stream_inline_history.go`**: `renderHistoryBatch` now adds an extra `\n` after `kindHeader` items, producing a consistent blank-line gap between the header panel and the first content item. This matches the initial render spacing.

### Test changes (1 file)

- Updated `TestRenderHistoryBatch_MatchesPerItemOutput` to account for the new header spacing.
- Added `TestRenderHistoryBatch_HeaderHasBlankLineGap` and `TestRenderHistoryBatch_HeaderOnly_NoExtraNewline`.

## Benefits

- **No duplicate headers**: Single header in terminal output, updated in-place when subject arrives
- **Consistent spacing**: Blank line gap after the header panel is identical between initial render and re-commit
- **Cleaner architecture**: Header rendering has a single source of truth (the inline renderer), eliminating the dual-write pattern
- **Zero performance impact**: Benchmarks unchanged (~1.9ms for 500-item re-commit)

## Impact

- **Users**: No more duplicate header panels in terminal scrollback. Subject appears in the header in-place (within one ClearScreen cycle) when the backend resolves it.
- **Detach mode**: Unchanged -- still renders header via `renderSessionHeader` since no inline renderer runs.
- **JSON mode**: Unchanged -- header still renders on stderr for context.
- **Non-TTY / CI**: Header prints once at startup via direct write fallback. No re-commit (no Bubbletea program). Subject updates silently update history for correctness.

## Related Work

- [Event history retention and subject update](2026-03-05-070144-event-history-retention-and-subject-update.md) -- Phase 1: introduced the re-commit mechanism and history[0] header storage
- [Re-commit performance optimization](2026-03-05-083840-re-commit-performance-optimization.md) -- Phase 5: batched re-commit into single Println
- [CLI session header subject enrichment](2026-03-04-111351-cli-session-header-subject-model-enrichment.md) -- Added subject polling

---

**Status**: Production Ready
**Timeline**: ~1 hour
