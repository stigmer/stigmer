# Phase 4: Approval Flow Migration to Bubbletea View()

**Date**: March 5, 2026

## Summary

Migrated the approval panel rendering from manual `termctl.EraseLines` cursor control to Bubbletea's `View()` state machine. The approval panel (expanded content, question, and interactive menu) is now rendered by Bubbletea, with the collapsed result committed via `tea.Println` Cmd. The `inApprovalFlow` sentinel — a workaround to prevent Bubbletea/direct-write conflicts — has been removed. Three of seven `EraseLines` call sites in the approval path are eliminated.

## Problem Statement

The inline approval flow used six `termctl.EraseLines` calls to manually control cursor position for expanding, menu re-rendering, and collapsing the approval panel. This hand-rolled cursor math was the primary source of rendering bugs (off-by-one rows, desynchronized cursor state, wrapping miscounts) and was architecturally incompatible with Bubbletea's managed rendering.

### Pain Points

- Three separate `EraseLines` sites for approval panel lifecycle (display, menu re-render on arrow key, collapse after decision) — each independently fragile
- The `inApprovalFlow` sentinel added complexity to every `statusf` call path, creating a parallel routing mechanism that was hard to reason about
- Direct stderr writes during approval bypassed Bubbletea's row tracking, requiring careful manual cursor synchronization
- Any new rendering feature in the approval flow required understanding both the Bubbletea rendering model and the manual cursor control model simultaneously

## Solution

Adopted a "hybrid" architecture where the blocking event loop reads raw keystrokes and relays visual updates to Bubbletea via `program.Send()`. Bubbletea manages all panel rendering through its `View()` function. This eliminates the cursor math while preserving the simple, sequential approval flow that the event loop provides.

## Implementation Details

### New Bubbletea Messages and Model State

Three new message types coordinate the approval lifecycle:

- `approvalShowMsg{content}` — activates the panel in View() with the pre-rendered expanded view + question
- `approvalSelectMsg{selected}` — updates the menu selection index on arrow keys
- `approvalHideMsg{collapsedResult}` — deactivates the panel; returns `tea.Println(collapsed)` as a Cmd

Model fields: `approvalActive`, `approvalContent`, `approvalSelected`. View() priority: approval > spinner > empty.

### InlinePrompter Changes

- `RenderMenu` exported for Bubbletea View() to call
- `PromptKeyOnly` method added: enters raw mode, reads keystrokes, calls `onSelect` callback on arrow changes, returns decision on Enter/Esc. Does not render the menu — Bubbletea handles that

### Approval Flow Restructuring

`handleInteractiveApproval` now dispatches to two paths:

- **Bubbletea path** (`promptApprovalViaBubbletea`): sends `approvalShowMsg`, reads keys via `PromptKeyOnly` with selection relay, sends `approvalHideMsg` with collapsed result
- **Direct-write fallback** (`promptApprovalDirect`): preserves the existing `PromptWithLineCount` + `EraseLines` path for non-TTY/CI/tests

Helper extractions: `erasePreApprovalContent` (shared streaming erasure), `formatCollapsedResult` (string builder without printing), `handlePromptErrorAfterHide` (error handling when panel already hidden via Bubbletea).

### inApprovalFlow Removal

The sentinel field, its set/clear guards in `handleEvent`, and the gate in `statusf` are all removed. `statusf` now unconditionally routes through `program.Println` when program is non-nil.

## Benefits

- **3 fewer EraseLines call sites** in the approval flow (display, menu re-render, collapse)
- **Eliminated the `inApprovalFlow` sentinel** — one fewer dimension in the rendering state machine
- **Simplified `statusf`** — single routing rule (Println when program exists, direct write otherwise)
- **View() manages panel lifecycle** — Bubbletea's automatic row tracking handles clearing, no manual cursor math
- **FIFO ordering guarantee** — `approvalHideMsg` clearing the panel and `tea.Println` committing the collapsed result are sequenced by Bubbletea's internal message processing

## Impact

- **CLI inline renderer**: Approval panel rendering is now framework-managed
- **pkg/approval**: `RenderMenu` is now exported; `PromptKeyOnly` provides a rendering-agnostic input method
- **Test infrastructure**: 13 new tests for approval model messages and PromptKeyOnly; 2 obsolete sentinel tests removed; all existing tests pass
- **Non-TTY/CI**: Zero impact — direct-write fallback preserves existing behavior

## Related Work

- Phase 1: Bubbletea Program Shell (foundation)
- Phase 2: Spinner Migration to View()
- Phase 3: Header Simplification (lineCountingWriter deletion)
- **Phase 5 (next)**: Tool Streaming Migration — will eliminate the remaining 4 EraseLines call sites

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
