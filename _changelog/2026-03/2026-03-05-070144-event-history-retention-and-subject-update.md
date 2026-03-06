# Event History Retention + Session Subject Update

**Date**: March 5, 2026

## Summary

Added an event history retention layer to the Stigmer CLI inline renderer, enabling the terminal display to be fully reconstructed from structured data on demand. First use case: the session header subject updates in-place when the backend resolves the auto-generated title, using a clear+re-commit mechanism through Bubbletea's render loop.

## Problem Statement

The inline renderer committed output to terminal scrollback as a one-way stream — once content was written via `tea.Println` or `fmt.Fprint`, there was no way to update it. This made several desirable features impossible:

### Pain Points

- **Session subject** is resolved asynchronously by the backend (LLM-generated title). The header panel displayed "no subject" until the user re-attached to the session.
- **Expand/collapse toggle** (like Claude Code's Ctrl+O) requires re-rendering all tool calls in a different mode — impossible without retained history.
- **Read group expansion** requires knowing which reads were grouped and their original data.
- **Terminal resize re-rendering** and theme toggles need the same capability.

## Solution

Introduced a structured event history on the renderer and a clear+re-commit pipeline through the Bubbletea model. Every item committed to terminal scrollback is recorded as a `committedItem` with enough structured data to re-render it identically (or in a different mode in future phases). When a re-render is needed, the renderer snapshots the history and sends it to the Bubbletea model, which atomically clears the terminal and replays all items via `tea.Sequence(ClearScreen, Println, Println, ...)`.

## Implementation Details

### New Types (`run_stream_inline_history.go`)

- `committedKind` — 12-variant enum classifying every type of committed output (header, tool compact, read group, approval, AI message, human message, system message, sub-agent lifecycle, todo update, phase change, generic text).
- `committedItem` — struct storing the kind, pre-rendered text (for mode-invariant items), structured data (for mode-variable items like tool calls), and metadata (sub-agent ID, action string, header pointer).
- `renderCommittedItem` — pure function that re-renders any item to its display string, dispatching on kind.
- `reCommitHistory` — builds a `tea.Cmd` sequence of ClearScreen + Println for each item.
- `triggerReCommit` — packages a history snapshot and sends `reCommitMsg` to the Bubbletea model.

### History Recording (`run_stream_inline_render.go`)

Every render method now appends a `committedItem` after producing output. Items that may render differently in compact vs expanded mode (tool calls, read groups, approvals, header) store structured data. Mode-invariant items (AI messages, system messages, lifecycle events) store pre-rendered text.

### Subject Polling (`run_stream_inline_header_update.go`)

A `pollSessionSubject` goroutine polls the backend every 3 seconds (max 10 attempts) for the resolved subject. When found, it sends the subject on a channel consumed by the renderer's select loop.

### Call Chain Threading

The dead `sessionSubject string` parameter on `streamAgentExecution` was replaced with `sessionHeaderInfo` — a struct carrying the full header metadata. This is threaded through `streamAgentInline` into the renderer config, where it becomes `history[0]` (kindHeader).

### Re-commit Trigger

When the subject resolves, the renderer mutates `history[0].header.Subject`, calls `triggerReCommit`, and nils the channel to prevent further polling. The Bubbletea model's `handleReCommit` returns the reconstructed `tea.Sequence` Cmd.

## Benefits

- **Session subject appears in-place** — no need to re-attach or restart the session to see the resolved title
- **Foundation for expand/collapse** — the history infrastructure is the prerequisite for Phase 2 (Ctrl+O toggle)
- **Zero behavioral regression** — the first 5 implementation steps introduced no visible changes; only Step 6 (subject update wiring) is the first behavioral change
- **Clean separation** — history ownership on the renderer, re-commit orchestration on the model, polling in a standalone goroutine

## Impact

- **End users**: Session header subject now appears automatically ~3-10 seconds into a new session, without any user action
- **Codebase**: 4 new files (~350 lines), 11 modified files (~170 lines changed), dead `sessionSubject` parameter cleaned up
- **Future phases**: Phase 2 (expand/collapse), Phase 3 (Ctrl+O keybinding), Phase 4 (follow-up history, resumed session Bubbletea) all build on this foundation

## Related Work

- Predecessor: Bubbletea inline renderer migration (project `20260305.01`, Phases 1-7)
- Parent plan: `_projects/2026-03/20260305.02.expand-collapse-tools/tasks/T01_0_plan.md`
- Implementation plan: `.cursor/plans/phase_1_event_history_0eda7a7b.plan.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
