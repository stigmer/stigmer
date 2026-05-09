# Fix: Eliminate Blank Screen During Agent Execution Startup

**Date**: May 9, 2026

## Summary

Fixed a UX gap where the message thread went blank for several seconds during agent execution startup. The setup progress indicator was only shown during the `EXECUTION_PENDING` phase, but the phase transitions to `EXECUTION_IN_PROGRESS` before the agent produces its first AI message -- leaving users staring at an empty screen with no feedback.

## Problem Statement

When a user starts an agent execution, the UI goes through these phases:

1. `EXECUTION_PENDING` -- setup progress is shown ("Initializing execution...", "Setting up workspace...", etc.)
2. `EXECUTION_IN_PROGRESS` -- the agent-runner has started but hasn't produced output yet
3. First AI message arrives -- the thread becomes populated

The gap between phases 2 and 3 (typically 1-5 seconds, sometimes longer with slow LLM cold starts) produced a completely blank message thread. This violates Nielsen's heuristic #1 (Visibility of System Status) -- users reported confusion about whether the system had disconnected.

### Pain Points

- Blank screen between setup completion and first AI message creates uncertainty
- The timer-based fallback during PENDING stops cycling after ~16 seconds ("Almost ready..." stuck forever)
- Early setup steps (execution fetch, chain resolution, config loading) had no server-reported progress -- only the timer fallback

## Solution

**Frontend-driven gap closure** -- the frontend already knows the execution is active (phase is `IN_PROGRESS`) and that no messages exist yet. It now uses this information to show a "Thinking..." indicator instead of a blank screen.

This approach works for all runner implementations (Graphton, Cursor, future runners) without requiring each to implement additional progress reporting.

## Implementation Details

### Layer 1: Frontend (Critical -- eliminates blank screen)

**`MessageThread.tsx`** -- Extended `buildThreadItems` to show a progress indicator during `EXECUTION_IN_PROGRESS` when no AI messages have arrived. The `setup-progress` thread item now carries an `isAwaitingResponse` flag that distinguishes the "thinking" mode from the "setup" mode.

**`SetupProgress.tsx`** -- Added an `isAwaitingResponse` prop. The component now operates in three priority modes:
1. **Awaiting response** (`isAwaitingResponse=true`) -- shows "Thinking..." with pulse animation
2. **Server-driven** (`serverPhase` non-empty) -- renders server-reported label directly
3. **Timer fallback** (neither above) -- cycles through contextual status messages

The same `setup-progress` key is used across the PENDING -> IN_PROGRESS transition so React updates the indicator in place rather than unmounting and remounting.

### Layer 2: Agent-runner (Improves progress fidelity)

**`setup.py`** -- Added three `report_setup_progress` calls for early setup steps that previously had none:
- "Loading execution..." (before execution fetch)
- "Resolving agent configuration..." (before chain resolution)
- "Preparing runtime..." (before config/checkpointer setup)

This gives the server-driven mode a phase to display from the very first setup step instead of relying on the timer fallback for the first several seconds.

## Benefits

- No more blank screen during the PENDING -> IN_PROGRESS transition
- Server-driven setup phases now cover the full setup lifecycle (9 phases instead of 6)
- Users always see meaningful progress feedback from execution creation through first AI message
- Stable thread item key across phase transitions avoids DOM thrashing

## Impact

- **Direct users**: Every agent execution in the Stigmer Console and CLI now has continuous progress feedback
- **Platform builders**: `@stigmer/react` `MessageThread` and `SetupProgress` components gain the new behavior automatically; the `SetupProgress` API is backward-compatible (new `isAwaitingResponse` prop is optional)
- **SDK surface**: `SetupProgressProps` gains one optional prop -- no breaking change

## Related Work

- `SetupProgress` proto field (`setup_progress` on `AgentExecutionStatus`) was added previously to replace the timer-based fallback with server-reported phases
- `AgentExecutionUpdateStatusHandler.java` clears `setup_progress` when phase leaves `PENDING` (defense-in-depth behavior preserved, not modified)

---

**Status**: Production Ready
