# CLI Live Activity Feedback: Thinking Indicator and Connection Health

**Date**: February 15, 2026

## Summary

Added real-time activity indicators to the CLI execution TUI so users always know the agent is alive and what it's doing. The static "dead screen" during LLM thinking periods is replaced with an animated spinner in the header, and a connection health monitor warns when the backend becomes unreachable.

## Problem Statement

When the agent finishes reading files and enters its "thinking" phase (LLM processing before generating the next response), the CLI shows a completely static screen. Users cannot distinguish between:

- The agent actively thinking (normal behavior)
- The agent being stuck (a problem)
- A network disconnection (a problem)

### Pain Points

- The TUI is purely event-driven: it only updates when new messages or tool state changes arrive
- During LLM thinking, no LangGraph events are emitted, so no TUI events fire
- The spinner only runs during the "pending" phase and stops the moment execution starts
- The backend sends keepalive updates every 5 seconds, but the CLI's `streamToEvents` bridge only emits events on content changes — keepalive updates with no meaningful delta produce zero TUI events
- Users report confusion about whether the system is working or broken

## Solution

Two-layer approach: a client-side thinking indicator for immediate visual feedback, and a backend liveness monitor for connection health awareness.

### Layer 1: Thinking Indicator (Header Spinner During Idle)

Timer-driven activity detection that reactivates the header spinner when no events arrive for 2+ seconds during execution.

**Mechanism:**
- `activityTickMsg` fires every 1 second during execution
- Tracks `lastEventAt` — reset on every meaningful event (messages, tool calls, phase changes)
- After 2 seconds of silence during `in_progress` phase, sets `thinkingVisible = true`
- The existing `spinner.Model` is reused (was only active during "pending" phase)
- Spinner ticks are forwarded when `thinkingVisible` is true, stopped when events resume
- The header switches from static `▶ in_progress` to animated `[dot] in_progress`

### Layer 2: Backend Liveness Awareness (Connection Health)

Heartbeat tracking that distinguishes "agent is thinking" from "connection lost."

**Mechanism:**
- New `HeartbeatEvent` emitted on every successful `stream.Recv()` call (including keepalive updates)
- `HeartbeatEvent` updates `lastBackendUpdate` but does NOT reset the activity tracker or clear the thinking indicator
- After 15 seconds without any backend update (3 missed keepalives), the footer shows a connection warning
- All other events also update `lastBackendUpdate`, so any stream activity confirms liveness

## Implementation Details

### New Types

- `activityTickMsg` — Internal Bubbletea message for the periodic idle detection timer
- `HeartbeatEvent` — Event interface implementation for backend liveness signals; unlike other events, does not reset the activity tracker

### Model Changes (`model.go`)

- `lastEventAt time.Time` — Tracks when the last meaningful execution event was received
- `thinkingVisible bool` — Controls whether the header shows the animated spinner
- `lastBackendUpdate time.Time` — Tracks when the last gRPC stream update was received (including keepalives)
- `Init()` now starts `scheduleActivityTick()` alongside the spinner and event listener

### Update Loop (`update.go`)

- `activityTickMsg` handler: Checks idle threshold (2s), sets `thinkingVisible`, restarts spinner
- `spinner.TickMsg` handler: Extended to forward ticks when `thinkingVisible` is true (not just "pending")
- Three timing constants: `activityTickInterval` (1s), `idleThreshold` (2s), `connectionStaleThreshold` (15s)

### Event Handling (`handle_events.go`)

- Every event updates `lastBackendUpdate` (confirms backend is alive)
- `HeartbeatEvent` handled as early return — only updates liveness, no viewport change
- All other events reset `lastEventAt` and clear `thinkingVisible`

### View Layer (`view.go`)

- `renderHeader()` shows animated spinner when `m.phase == "pending" || m.thinkingVisible`
- `renderFooter()` shows connection warning when `isConnectionStale()` returns true
- `isConnectionStale()` checks `time.Since(m.lastBackendUpdate) > connectionStaleThreshold` during `in_progress`

### Stream Bridge (`run_stream_events.go`)

- Emits `HeartbeatEvent{}` after every successful `stream.Recv()`, before processing messages
- This fires on every backend update, including keepalives with no content changes

## Benefits

- **Immediate feedback**: Users see animation within 2 seconds of the last event, confirming the system is alive
- **Connection awareness**: Clear distinction between "thinking" and "disconnected" states
- **Zero backend changes**: Entirely CLI-side for Layer 1; Layer 2 only adds a lightweight event emission
- **No content pollution**: Thinking indicator lives in the header bar — no ephemeral blocks in the viewport
- **Spinner reuse**: No new visual components — reuses the existing `spinner.Dot` from the pending phase
- **Clean lifecycle**: Spinner starts/stops automatically based on event flow; no dangling timers after execution completes

## Impact

- **End users**: No more "dead screen" confusion during agent processing; clear feedback at all times
- **Operations**: Connection health monitoring surfaces network issues that were previously invisible
- **Codebase**: 156 lines added across 7 files; clean separation between activity tracking, liveness, and rendering

## Related Work

- Previous: `21dfbe24 feat(cli,apis,backend): add tool execution live streaming and liveness indicators` — Added the initial streaming infrastructure this builds upon
- Future consideration: Backend `activity_hint` field in the proto status for more specific messages ("thinking", "generating", "executing tool")

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
