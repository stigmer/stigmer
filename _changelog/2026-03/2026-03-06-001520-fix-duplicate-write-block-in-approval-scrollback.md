# Fix Duplicate Write Block in Approval Scrollback

**Date**: March 6, 2026

## Summary

Fixed a rendering bug where the HITL approval flow for `Write` tool calls displayed two "Write" blocks in terminal scrollback — a dead streaming snapshot followed by the correct expanded approval view. The root cause was a race between Bubbletea V2's `insertAbove` scroll calculations and the Cursed Renderer's timer-based `flush` cycle.

## Problem Statement

When the agent streamed a `Write` tool call and then transitioned to the approval prompt, users saw duplicate output:

1. A partial `Write()` block with truncated content and a "more lines" indicator
2. The full `Write(filepath)` block with complete content and the approval prompt

This made the approval flow look broken and cluttered the terminal scrollback with stale content.

### Pain Points

- Confusing UX: two Write blocks for a single tool call
- The first block showed incomplete information (no filepath, truncated content)
- The duplication was non-deterministic depending on timer tick timing

## Root Cause

Bubbletea V2 separates **view storage** from **view flushing**:

- `p.render(model)` stores the View() output in the renderer. Runs synchronously after every `Update()`.
- `p.renderer.flush()` updates `cellbuf` (resize, clear, draw) and writes to the terminal. Runs on a **timer tick** (~60fps).

`insertAbove()` (the mechanism behind `Println`) reads `s.cellbuf.Height()` to compute scroll offsets. Since `cellbuf` is only resized during `flush()`, `insertAbove` reads stale dimensions from the last flush.

When `streamingHideMsg`, `approvalStartMsg`, and the resulting `printLineMessage` were all processed within one timer tick, `insertAbove` used the stale streaming view height (e.g. 30 rows) instead of the updated approval view height (6 rows). The over-scroll pushed the physically-present streaming content into terminal scrollback.

The initial attempt (Session 8) — sending `streamingHideMsg` before approval to clear View() — did not work because `insertAbove` reads `cellbuf` dimensions, not `View()`, and `cellbuf` is only updated by `flush()`.

## Solution

For the streaming-to-approval transition, use the re-commit mechanism instead of bare `tea.Println`. When `contentStreamed` is true, the approval message carries a `reCommitPayload` (rendered history + expanded content). The model handler returns `buildReCommitCmd` (`tea.Sequence(tea.ClearScreen, tea.Println(eraseScrollback + payload))`) instead of `tea.Println(expandedContent)`.

The `\033[3J` (eraseScrollback) in the payload wipes ALL scrollback, including anything incorrectly pushed by `insertAbove`'s stale-height scroll. This is the same mechanism already proven for Ctrl+O toggle, approval collapse, and subject update.

Non-streaming approvals (shell commands, etc.) continue using the `Println` path since there is no stale cellbuf height to cause incorrect scrolling.

## Implementation Details

**Messages** (`run_stream_inline_messages.go`): Added `reCommitPayload string` field to `approvalStartMsg` and `approvalShowMsg`.

**Model handlers** (`run_stream_inline_bubbletea.go`): `handleApprovalStart` and `handleApprovalShow` check `msg.reCommitPayload` — when non-empty, return `buildReCommitCmd(payload)` instead of `tea.Println(expandedContent)`.

**Approval flow** (`run_stream_inline_approval.go`): `handleInteractiveApproval` builds the re-commit payload (`renderHistoryBatch + expanded`) when `contentStreamed` is true and passes it through `promptApprovalViaBubbletea` to the channel/key-reader paths.

**Cleanup** (`run_stream_inline.go`): Removed the `streamingHideMsg` pre-switch interception from `handleEvent` — the re-commit mechanism handles the transition entirely.

**Tests** (`run_stream_inline_bubbletea_test.go`): Replaced `TestInlineBubbleModel_StreamingHide_BeforeApprovalStart` with three tests:
- `TestInlineBubbleModel_ApprovalStart_ReCommitForStreamedContent`: verifies the re-commit path
- `TestInlineBubbleModel_ApprovalStart_FallsBackToPrintln`: verifies the Println fallback for non-streaming approvals
- `TestInlineBubbleModel_ApprovalShow_ReCommitForStreamedContent`: verifies the legacy path

## Benefits

- Clean, single Write block in terminal scrollback during approval
- No flickering or stale content during the streaming → approval transition
- Uses the proven re-commit mechanism (same as Ctrl+O, approval collapse)
- Non-streaming approvals are unaffected

## Trade-off

Pre-session terminal history is lost on approval display for streamed write/edit tools. This matches the existing behavior for Ctrl+O toggle and is an accepted pattern.

## Impact

- **End users**: Approval flow for file-writing tools (`Write`, `EditFile`, etc.) now renders cleanly without duplicate blocks
- **Maintainability**: The fix uses the existing re-commit infrastructure, documented in DD-001

## Related Work

- Part of the Bubbletea V2 upgrade project (`20260305.03.bubbletea-v2-upgrade`)
- Design decision: `_projects/2026-03/20260305.03.bubbletea-v2-upgrade/design-decisions/001-scrollback-clear-3J.md`

---

**Status**: ✅ Production Ready
**Files Changed**: 5 (4 source + 1 test)
