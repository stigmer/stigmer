# Unify Live Rendering Spacing with Recommit Spacing

**Date**: March 6, 2026

## Summary

Eliminated the visual spacing discrepancy between live agent execution output and post-recommit output by unifying both codepaths into a single source of truth. Previously, live-streamed tool calls and AI messages appeared too close together during execution, but snapped to correct spacing when a recommit occurred (Ctrl+O, approval, subject update). Now both paths produce byte-for-byte identical output.

## Problem Statement

The CLI inline renderer had **two independent spacing codepaths** that didn't agree:

1. **Live path** — each render function (`renderToolCompleted`, `renderAIStreamEnd`, `flushPendingReads`, etc.) independently managed trailing spacing via ad-hoc `statusf` calls scattered across 7+ functions.
2. **Recommit path** — `renderHistoryBatch` applied uniform spacing rules: one `\n` between items, extra `\n` for header and gap-classified kinds, and trailing `\n` inside multi-line item text.

### Pain Points

- Live execution showed items packed tightly together (missing blank lines between phase changes, tool completions, etc.)
- Triggering a recommit (Ctrl+O toggle, approval completion, streaming tool finish) would visibly reflow the terminal with correct spacing — a jarring visual jump
- AI messages had an extra blank line in live output that disappeared after recommit
- Todo updates had an extra blank line in live output that disappeared after recommit
- Phase change events (failed/cancelled) were missing a blank line in live output that appeared after recommit

## Solution

Introduced `commitToScrollback(item committedItem)` as the single method through which all live output flows. This method:

1. Appends the item to the history buffer
2. Renders the display text via `renderCommittedItem` (the same function `renderHistoryBatch` uses)
3. Computes trailing gap via a shared `needsTrailingGap(kind)` helper (extracted from `renderHistoryBatch`)
4. Commits to terminal scrollback via `statusf` with identical spacing to what `renderHistoryBatch` would produce

A companion `recordToHistory(item committedItem)` method handles cases where visual output was already committed progressively (AI streaming line-by-line, Bubbletea approval path) and only the history record is needed.

## Implementation Details

### Shared spacing helper

Extracted `needsTrailingGap(kind committedKind) bool` from inline logic in `renderHistoryBatch`. Now used by both `renderHistoryBatch` (recommit) and `commitToScrollback` (live) to guarantee identical gap decisions.

### Files changed

- **`run_stream_inline_history.go`** — Extracted `needsTrailingGap` helper, replaced inline `needsGap` variable in `renderHistoryBatch`
- **`run_stream_inline_render.go`** — Added `commitToScrollback` and `recordToHistory` methods; refactored all render functions (`renderToolCompleted`, `renderHumanMessage`, `renderSystemMessage`, `renderPhaseChange`, `renderTodoUpdate`, `renderSubAgentStarted`, `renderSubAgentCompleted`, `flushPendingReads`, `renderDone`, `renderStreamError`) to delegate to `commitToScrollback`
- **`run_stream_inline_aistream.go`** — Removed extraneous `Println("")` blank lines from `renderAIStreamEnd` and `finishAIStreamIfNeeded`; converted `renderAIMessage` (non-streamed) to use `commitToScrollback`; simplified `recordAIMessage` to use `recordToHistory`
- **`run_stream_inline_streaming.go`** — Refactored `completeStreamingTool`: Bubbletea path uses `recordToHistory` + `triggerReCommit`; direct-write path uses `commitToScrollback`
- **`run_stream_inline_approval_display.go`** — Converted `printCollapsedResult` to `commitToScrollback`, `recordApproval` to `recordToHistory`
- **`run_stream_inline.go`** — Aligned initial header rendering pattern; converted follow-up prompt history recording to `recordToHistory`
- **`run_stream_inline_history_test.go`** — Added `TestCommitToScrollback_MatchesRecommit` (verifies live output matches `renderHistoryBatch` for both compact and expanded modes), `TestNeedsTrailingGap`, updated existing test to use shared helper

### Key design decisions

- **All `r.history = append` calls are now confined to two methods**: `commitToScrollback` (live render + history) and `recordToHistory` (history only). No other code directly mutates the history slice.
- **`kindAIMessage` is NOT in `needsTrailingGap`**: AI messages don't get a trailing blank line, matching the recommit path. This keeps AI message → tool call transitions compact.
- **Non-Bubbletea fallback preserved**: The data writer (stdout) path for piped/redirected output retains its existing `\n\n` paragraph breaks — that's a separate concern from terminal display spacing.

## Benefits

- **Zero visual delta on recommit**: Live output and recommitted output are now byte-for-byte identical, eliminating the jarring reflow
- **Single source of truth**: Spacing logic lives in one place (`needsTrailingGap` + `commitToScrollback`), not scattered across 7+ render functions
- **Test-verified parity**: `TestCommitToScrollback_MatchesRecommit` commits a comprehensive sequence of every item kind and asserts the output matches `renderHistoryBatch`
- **Reduced code duplication**: Each render function dropped its ad-hoc `statusf` + `strings.Contains` + conditional blank line logic in favor of a single `commitToScrollback` call

## Impact

- **End users**: Consistent terminal spacing throughout an agent execution session — no more visual jumps when recommit triggers fire
- **Maintainers**: Adding a new `committedKind` only requires updating `needsTrailingGap` (if it needs a gap) and `renderCommittedItem` — spacing is automatically correct in both live and recommit paths

## Related Work

- [Full content pre-approval streaming](2026-03-06-021906-full-content-pre-approval-streaming.md) — introduced progressive line-by-line commits that surfaced the spacing discrepancy
- [Fix raw recommit line endings](2026-03-06-015824-fix-raw-recommit-line-endings-for-raw-terminal-mode.md) — related recommit rendering fix
- [Fix recommit scrollback duplication via raw](2026-03-06-013928-fix-recommit-scrollback-duplication-via-raw.md) — atomic recommit architecture that this change complements

---

**Status**: ✅ Production Ready
**Timeline**: Single session
