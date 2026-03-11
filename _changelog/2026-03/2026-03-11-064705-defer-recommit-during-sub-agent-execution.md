# Defer Re-Commit During Active Sub-Agent Execution

**Date**: March 11, 2026

## Summary

Fixed the remaining sub-agent display flickering by deferring full-screen re-commits while sub-agents are running. The root cause was two async metadata fetchers (`pollSessionSubject`, `fetchRecentSessions`) triggering `performReCommit()` during active sub-agent execution, which stops Bubbletea, clears the entire screen, rewrites history, and starts a new program — causing a visible flash and momentary disappearance of the sub-agent stacked view.

## Problem Statement

Despite the previous fix that reduced View() redraw frequency and eliminated content volatility (elapsed time caching, slower tick rate), users still observed flickering during parallel sub-agent execution. The flickering was accompanied by a spacing gap between the last AI message and the sub-agent live view that only appeared intermittently — a telltale sign of a re-commit.

### Pain Points

- `fetchRecentSessions` returns within ~1 second of session start, triggering a re-commit while sub-agents are often already running
- `pollSessionSubject` polls every 3 seconds and typically resolves within 3–9 seconds, hitting the sub-agent execution window
- Each re-commit executes a destructive 5-step cycle: Quit program → Wait(2s timeout) → clear screen → rewrite history → start new program
- Between the old program dying and the new one rendering its first View(), the sub-agent stacked display vanishes — creating a visible flash
- The spacing between raw `fmt.Fprint` history and the new Bubbletea View() region differs from the live Println-managed layout, producing the gap artifact

## Solution

Extended the existing `pendingReCommit` deferral mechanism (which already handles AI streams) to also defer re-commits when sub-agents are active. The metadata is captured in history immediately; only the visual re-commit is postponed until the last sub-agent completes.

## Implementation Details

### Deferral condition (re-commit trigger)

Changed the re-commit gate from `r.inAIStream` to `r.inAIStream || len(r.activeSubAgents) > 0`. When a re-commit trigger fires during sub-agent execution, the flag `pendingReCommit` is set instead of calling `triggerReCommit()`.

### Release condition (after handleEvent)

Changed the pending check from `r.pendingReCommit && !r.inAIStream` to `r.pendingReCommit && !r.inAIStream && len(r.activeSubAgents) == 0`. The deferred re-commit fires only after the last sub-agent completes (via `renderSubAgentCompleted` → `handleEvent` → this check), ensuring the destructive screen cycle never disrupts the live sub-agent display.

## Benefits

- Zero flickering during sub-agent execution — the most visually active phase of a session
- Header metadata (subject, recent sessions) is still captured immediately in history
- Deferred re-commit fires cleanly when sub-agents complete, applying all buffered header updates at once
- No new state variables — reuses the existing `pendingReCommit` flag

## Impact

- **CLI users**: Sub-agent parallel execution display is completely stable — no more flashes or gap artifacts
- **Correctness**: No behavioral change to event processing, history tracking, or metadata capture
- **Architecture**: Two-line change, same deferral pattern already proven for AI streams

## Related Work

- Changelog: `2026-03-11-062209-fix-sub-agent-display-flickering` (previous fix addressing View() volatility)
- Changelog: `2026-03-11-044822-fix-parallel-sub-agent-display` (multi-slot sub-agent architecture)
- Project: `20260309.01.sub-agent-execution-streamline`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
