# Consolidate AI Output Through Bubbletea

**Date**: March 5, 2026

## Summary

Eliminated cursor desynchronization bugs in the CLI inline renderer by routing all AI text output through Bubbletea when a program is active. Previously, AI text was written directly to stdout while tool renders went through Bubbletea on stderr — both sharing the same terminal cursor — causing tool output to appear on the same line as AI text instead of starting on a new line.

## Problem Statement

The inline renderer used two separate output channels (stdout for AI text, stderr for tool/status output via Bubbletea) that shared the same terminal cursor. Bubbletea's View() re-renders use ANSI cursor movements to manage the dynamic bottom region, but those cursor calculations did not account for bytes written directly to stdout. This caused a class of visual bugs where content collided on the same line.

### Pain Points

- AI text ending with a colon followed by a tool call (e.g., "simultaneously:● Read 6 files") appeared on the same line instead of separate lines
- The `stopThinkingSpinner` race condition could erase stdout content when Bubbletea re-rendered the View region
- The two-channel design was a premature optimization — piping AI content to stdout is useful, but it should not come at the cost of correct terminal rendering in the common case

## Solution

Consolidated all visual output through Bubbletea when a program is active:

- **Complete lines** (terminated by `\n`) are committed to terminal scrollback via `program.Println`
- **Partial lines** (the in-progress typing line) are displayed live in Bubbletea's `View()` via a new `aiStreamPartialMsg`, providing character-level streaming feedback
- **Stream end** commits the remaining partial line and a paragraph gap via `Println`
- **Piped stdout** is preserved as a secondary write path — AI text is also written to stdout when it's piped/redirected (not a TTY), because piped stdout does not share the terminal cursor

## Implementation Details

### New file: `run_stream_inline_aistream.go` (~237 lines)

Extracts and refactors all AI streaming logic from `run_stream_inline_render.go`:

- `renderAIStreamStart` — initializes the stream buffer and prefix, sends `aiStreamPartialMsg` to View()
- `renderAIStreamDelta` — appends new bytes to buffer, commits complete lines via `commitAIStreamLines`, updates View() partial
- `renderAIStreamEnd` — commits remaining partial + gap, sends `aiStreamHideMsg` to clear View()
- `finishAIStreamIfNeeded` — handles interrupted streams (same pattern as stream end)
- `renderAIMessage` — handles non-streamed AI messages via `Println`
- `commitAIStreamLines` — core loop: scans buffer for `\n`, commits each complete line, applies bullet prefix to first line only
- `agentPrefix`, `recordAIMessage` — moved unchanged from render.go

### Modified files

- **`run_stream_inline_types.go`** — Added `dataIsTTY`, `aiStreamBuffer`, `aiStreamPrefix` fields to `inlineRenderer`
- **`run_stream_inline_messages.go`** — Added `aiStreamPartialMsg` and `aiStreamHideMsg` message types
- **`run_stream_inline_bubbletea.go`** — Added `aiStreamActive`/`aiStreamPartial` to model, Update cases, handler methods, and View() priority slot between followUp and spinner
- **`run_stream_inline_render.go`** — Removed 7 AI rendering functions (moved to new file), reduced from 375 to 289 lines
- **`run_stream_inline.go`** — Added `termctl.IsSupported(cfg.data)` to detect piped stdout
- **`run_stream_inline_spinner.go`** — Updated `stopThinkingSpinner` comment to reflect consolidated architecture
- **`BUILD.bazel`** — Registered new source file

## Benefits

- **Eliminates cursor desync bugs**: All visual output flows through a single cursor-aware system (Bubbletea), making it impossible for stdout writes to interfere with View() re-renders
- **Preserves streaming UX**: Character-level feedback via View() partial lines — the user sees every token as it arrives, identical to the previous direct-write behavior
- **Preserves piping**: `stigmer run "..." | grep` still captures AI text on stdout, but only when stdout is actually piped
- **Simplifies reasoning**: One output path to reason about when debugging rendering issues, rather than two interleaving channels

## Impact

- **Users**: The visual bug where tool actions appeared on the same line as AI text is fixed
- **Developers**: Easier to reason about rendering correctness — all output ordering is guaranteed by Bubbletea's message queue
- **Tests**: All 10 AI streaming tests pass unchanged (they use `program=nil` fallback path)

## Related Work

- Follows the Bubbletea inline renderer migration (Phases 1–7) that moved tool rendering through Bubbletea
- This change completes the consolidation by bringing AI text into the same channel

---

**Status**: ✅ Production Ready
**Timeline**: Single session
