# Fix Scrollback Duplication on Re-Commit

**Date**: March 5, 2026

## Summary

Fixed a terminal escape sequence ordering bug that caused the entire session history to appear duplicated in scrollback whenever the header was re-rendered (subject resolution, recent sessions, Ctrl+O toggle). Also cleaned up redundant echo output from the MCP server onboarding script.

## Problem Statement

When the session header was re-committed — triggered by the async subject resolution, recent sessions fetch, or Ctrl+O expand toggle — users saw the full session history duplicated when scrolling up in the terminal. The "Resolved version", "Workspaces", and onboarding banner text from external scripts also scattered into the output outside the Stigmer header panel.

### Pain Points

- Every re-commit produced a full copy of all previous content in scrollback
- The branded header panel rendered twice: once without Subject, once with Subject
- External script output ("Resolved version: v1.0.13", "=== Planton McpServer Onboarding ===") appeared as raw text between the headers instead of being contained within the panel
- For sessions with many tool calls, scrolling up showed the history 2-3 times

## Solution

Two independent fixes targeting the two root causes:

1. **Corrected escape sequence ordering** — moved `\033[3J` (Erase Saved Lines) from a direct write *before* `tea.ClearScreen` to an inline prepend in the `tea.Println` payload *after* `tea.ClearScreen`. This ensures the scrollback wipe runs after `\033[2J` has pushed content into it.

2. **Cleaned up onboarding script** — removed redundant echo statements from `agent-fleet/tools/00_onboard-planton-mcp-server.sh` that printed version, workspaces, and a banner to stdout before the Stigmer CLI started. This metadata is already displayed inside the CLI's header panel.

## Implementation Details

### Escape sequence ordering fix (`run_stream_inline_history.go`)

The bug was in `triggerReCommit()`. The original code wrote `\033[3J` directly to `cfg.status` *before* sending `reCommitMsg` to the Bubbletea program. Since `tea.ClearScreen` (`\033[2J`) is processed asynchronously by the Bubbletea event loop, the sequence was:

1. `\033[3J` — clears current scrollback (correct at this point)
2. `\033[2J` — clears visible screen, but in modern terminals (iTerm2, macOS Terminal, Ghostty) this **pushes visible content into scrollback**
3. Net result: old content reappears in scrollback after being "cleared"

The fix introduces an `eraseScrollback` constant and prepends it to the `tea.Println` payload in `buildReCommitCmd()`. Since `tea.Sequence` guarantees `tea.Println` runs after `tea.ClearScreen`, the terminal now processes:

1. `\033[2J\033[1;1H` — pushes visible to scrollback, repositions cursor
2. `\033[3J` — wipes scrollback (including what step 1 just pushed)
3. Rendered history — fresh content

This is atomic within a single Bubbletea event-loop tick — no race condition.

### Onboarding script cleanup (`00_onboard-planton-mcp-server.sh`)

Removed the `echo "Resolved version: ${LATEST_TAG}"` and the `=== Planton McpServer Onboarding ===` banner block. The `LATEST_TAG` variable is still resolved and used in the message template passed to `stigmer draft mcp-server` — only the terminal echo output was removed.

## Benefits

- Scrollback is clean after any re-commit trigger (subject update, recent sessions, Ctrl+O toggle)
- No more duplicate headers or scattered metadata text
- The onboarding script produces minimal output — just the progress indicator and completion summary
- The fix benefits all three re-commit callers without per-caller changes

## Impact

- **CLI users**: No more duplicated session history when scrolling up after the first 3-6 seconds of a session
- **Agent-fleet scripts**: Cleaner terminal output from `00_onboard-planton-mcp-server.sh`
- **Design decision 001**: Amended with the corrected ordering rationale and Session 8 amendment

## Related Work

- Design decision: `001-scrollback-clear-3J.md` (originally Session 3, amended Session 8)
- Research: `research.inline-rerender-without-scrollback-duplication/01.prompt.md`
- Prior implementation: Phase 2 scrollback fix (commit `e7c914dc`)
- Branded welcome header: Session 7 (commit `4dc57420`)

---

**Status**: Production Ready
**Timeline**: 30 minutes (diagnosis + fix)
