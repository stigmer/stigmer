# Unified Scrollback Write Path

**Date**: March 6, 2026

## Summary

Eliminated all direct `program.Println` calls from the renderer by routing every scrollback write through a single `writeToScrollback` method. Added transition-aware leading-gap logic (`needsLeadingGap`) so that live rendering and recommit produce identical spacing without manual `Println("")` gap calls scattered across the streaming code.

## Problem Statement

The inline renderer had two distinct paths for writing to terminal scrollback:

1. **Structured path** — `commitToScrollback` → `statusf` → `program.Println`, which used `needsTrailingGap` to manage blank-line gaps between items.
2. **Streaming path** — direct `program.Println` calls in `commitAIStreamLines`, `renderAIStreamEnd`, `finishAIStreamIfNeeded`, and `commitStreamHeader`, with manually placed `Println("")` for gaps.

### Pain Points

- The streaming path had no awareness of gap rules; every gap was a hardcoded `Println("")`
- Adding new item kinds or changing gap rules silently desynchronised the streaming path from the structured path
- Live output showed inconsistent spacing compared to recommit output (e.g., missing blank line after tool blocks before AI messages)
- Tool-to-message transitions had no leading gap during live streaming but did after recommit, causing visible layout shifts

## Solution

Introduced a single `writeToScrollback(kind committedKind, text string)` method on `inlineRenderer` that encapsulates all gap logic (both leading and trailing). Every scrollback write — whether from a history-tracked `commitToScrollback` call or a transient AI stream line — now flows through this method.

## Implementation Details

### New method: `writeToScrollback`

Central funnel that handles:
- **Leading gap**: calls `needsLeadingGap(r.lastScrollbackKind, kind)` to insert a blank line when transitioning from a dense tool/read block to non-dense content
- **Content write**: `statusf("%s\n", text)`
- **Trailing gap**: existing `needsTrailingGap(kind)` logic plus the header-specific gap
- **State tracking**: updates `r.lastScrollbackKind` after every write

### New kind: `kindAIStreamLine`

Added to `committedKind` enum for individual streaming lines. Opts out of trailing gap (lines stack tightly within one AI message) but triggers a leading gap when following a tool block.

### New function: `needsLeadingGap(prev, current)`

Encodes the rule: after a dense-stacking block (tools/reads), insert a blank line before any non-dense item. Applied in both `writeToScrollback` (live) and `renderHistoryBatch` (recommit) for consistent spacing.

### New helper: `commitStreamEndGap`

Emits the trailing gap that a completed AI message would produce and sets `lastScrollbackKind` to `kindAIMessage`. Replaces the manual `Println("")` calls at AI stream end.

### New helper: `lastKindFromHistory`

Initialises `lastScrollbackKind` from the last non-todo item in `initialHistory` when resuming a session, so gap decisions for the first new item are correct.

### Routing changes

| Call site | Before | After |
|---|---|---|
| `commitAIStreamLines` | `program.Println(line)` | `writeToScrollback(kindAIStreamLine, line)` |
| `renderAIStreamEnd` | `program.Println(line)` + `Println("")` | `writeToScrollback(kindAIStreamLine, line)` + `commitStreamEndGap()` |
| `finishAIStreamIfNeeded` | `program.Println(line)` + `Println("")` | `writeToScrollback(kindAIStreamLine, line)` + `commitStreamEndGap()` |
| `commitStreamHeader` | `program.Println(line)` per header line | `writeToScrollback(kindText, line)` per header line |
| Initial header write | `statusf("%s\n", header)` + `statusf("\n")` | `writeToScrollback(kindHeader, header)` |

### Test coverage

- `TestNeedsLeadingGap` — 16 transition cases
- `TestLastKindFromHistory` — 5 cases (empty, single, trailing todo, all todo, mixed)
- `TestRenderHistoryBatch_LeadingGapAfterTools` — verifies tool→message gap in recommit
- `TestWriteToScrollback_TracksLastKind` — state tracking
- `TestWriteToScrollback_EmptyTextNoOp` — no-op for empty text
- `TestCommitStreamEndGap` — trailing gap + kind update
- Updated `TestRenderHistoryBatch_MatchesPerItemOutput` to include leading-gap logic in its reference loop
- Updated `TestNeedsTrailingGap` to cover `kindAIStreamLine`
- `TestCommitToScrollback_MatchesRecommit` passes unchanged (parity verified)

## Benefits

- **Single source of truth**: every `program.Println` in the renderer goes through `statusf`, called only by `writeToScrollback`
- **Consistent spacing**: live output and recommit output are byte-for-byte identical
- **Safe by default**: new item kinds inherit correct gap behaviour without remembering to update multiple code paths
- **Eliminates manual gap management**: no more `Println("")` scattered across AI streaming and tool streaming code

## Impact

- CLI inline renderer: all interactive terminal output
- Affects all users running `stigmer run` in a terminal

## Related Work

- [Unify live vs recommit spacing](2026-03-06-193154-unify-live-vs-recommit-spacing.md) — prior iteration that unified trailing-gap logic
- [Always-visible input bar](2026-03-06-203150-always-visible-input-bar-escape-to-interrupt.md) — persistent UI that motivated the gap investigation
- [Fix chronological tool event ordering](2026-03-06-000611-fix-duplicate-message-and-spacing-regression.md) — bridge-layer fix for event ordering

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours
