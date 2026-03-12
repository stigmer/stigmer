# Fix Sub-Agent Timer Flickering and Add Live Tool Count

**Date**: March 12, 2026

## Summary

Fixed a timer reset bug in the CLI sub-agent live view where the elapsed counter restarted from zero on every streaming tool completion, and added a running tool count to the live display so users can see sub-agent progress while it executes.

## Problem Statement

When a sub-agent ran in the CLI, the "Working... (Ns)" spinner displayed correctly initially but would flicker and reset the elapsed timer back to zero repeatedly. This happened every time a streaming tool completed inside the sub-agent, making the display feel broken and unreliable.

Additionally, during sub-agent execution the user had no visibility into how many tools had been executed — that information only appeared in the scrollback summary after the sub-agent completed.

### Pain Points

- Elapsed timer restarting from zero mid-execution broke user confidence in the display
- Spinner animation jitter on every re-commit was visually distracting
- No live progress indicator during potentially long-running sub-agent work
- Users had to wait for sub-agent completion to see any tool execution count

## Solution

Two surgical fixes that preserve the existing architecture:

1. **Preserve temporal identity across re-commits** — store the canonical start time on `subAgentBlock` (the renderer-side aggregate that survives Bubbletea program restarts) and use it in `transferSubAgentEntries` instead of `time.Now()`
2. **Surface tool count via a dedicated Bubbletea message** — propagate the already-tracked `toolCount` from the renderer to the live display entry on each tool completion

## Implementation Details

### Timer Fix

**Root cause**: Two code paths in `completeStreamingTool` and `promptApprovalBubbletea` call `triggerReCommit()` during active sub-agent execution, bypassing the deferral guard in the main event loop. Each re-commit invokes `transferSubAgentEntries()` which was resetting `spinnerStart: time.Now()` and `subAgentSpinnerFrame = 0`.

**Fix**: Added `startedAt time.Time` to `subAgentBlock`, set once in `renderSubAgentStarted`. `transferSubAgentEntries` now copies `block.startedAt` to the display entry's `spinnerStart` and no longer resets the spinner frame.

### Live Tool Count

**Approach**: Added `subAgentToolCountMsg{id, count}` Bubbletea message type. `appendToSubAgentBlock` and `flushPendingReads` send this message when routing tool completions to a sub-agent block. The Bubbletea model updates the matching `subAgentDisplayEntry.toolCount`, and `renderSubAgentLine` renders it:

```
  ● Sub-agent: Scan auth0-webhooks dependencies
    ⠋ Working… 3 tools (12s)
```

When `toolCount == 0`, the display is unchanged from the previous format.

### Files Changed

- `run_stream_inline_types.go` — added `startedAt` to `subAgentBlock`, `toolCount` to `subAgentDisplayEntry`, updated struct comments
- `run_stream_inline_render.go` — set `startedAt: time.Now()` on block creation, send `subAgentToolCountMsg` from `appendToSubAgentBlock` and `flushPendingReads`
- `run_stream_inline_messages.go` — added `subAgentToolCountMsg` type
- `run_stream_inline_bubbletea.go` — added `handleSubAgentToolCount` handler, wired in `Update`, updated `renderSubAgentLine` to show tool count
- `run_stream_inline_history.go` — `transferSubAgentEntries` preserves `startedAt` and `toolCount` from block
- `run_stream_inline_bubbletea_test.go` — 5 new tests, 1 updated test
- `run_stream_inline_history_test.go` — 1 new test
- `run_stream_inline_test.go` — 1 updated test

## Benefits

- Elapsed timer now runs continuously from the real sub-agent start time, regardless of re-commits
- Spinner animation no longer jitters on screen redraws
- Users see live tool count progress during sub-agent execution
- Tool count survives re-commits via `transferSubAgentEntries`
- Low-frequency updates (only on tool completion) — no content volatility concerns

## Impact

- **CLI users**: Smoother, more informative sub-agent live display
- **Maintainers**: `subAgentBlock.startedAt` is now the canonical start time source, simplifying future display logic
- **Test coverage**: 6 new tests, 2 updated tests; full CLI root package suite passes

## Related Work

- Prior flickering fix (`443756fb`): removed `spinnerStart` reset in activity handler, introduced 150ms tick interval, added `elapsedStr` caching. This fix addresses the remaining re-commit path that the prior fix did not cover.
- Sub-agent execution streamline project (`20260309.01`): this is post-PR polish on the same feature area

---

**Status**: ✅ Production Ready
