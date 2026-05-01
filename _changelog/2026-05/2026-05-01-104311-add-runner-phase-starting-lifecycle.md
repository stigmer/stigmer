# Add RUNNER_PHASE_STARTING to Runner Lifecycle

**Date**: May 1, 2026

## Summary

Introduced a dedicated `RUNNER_PHASE_STARTING` phase to the runner lifecycle, allowing the platform to distinguish between a runner that is actively bootstrapping its runtime (downloading dependencies, creating virtualenvs) and one that has stopped or failed. This eliminates a UX problem where the desktop and web console UI would briefly show a spinner, then switch to "Stopped" while the runner was still actively starting up.

## Problem Statement

When a user clicks "Start Runner", the CLI begins a multi-step bootstrap process: downloading Node.js, installing npm dependencies, creating a Python virtualenv, and installing pip packages. During this window (which can take 30–120 seconds on first run), the runner had no way to signal its progress to the server. The heartbeat stream only started after bootstrap completed, so the server saw the runner as `PENDING` or `STOPPED` for the entire bootstrap duration.

### Pain Points

- Users would click "Start", see a brief spinner, then see "Stopped" — leading them to believe startup had failed
- Repeated manual start attempts during bootstrap caused confusion
- The UI relied on a 30-second client-side grace period timer to paper over the missing state, which was fragile and insufficient for longer bootstraps
- No server-side visibility into whether a runner was actively starting vs genuinely stopped

## Solution

Added `RUNNER_PHASE_STARTING = 6` as a first-class value in the `RunnerPhase` protobuf enum. The CLI now opens the gRPC heartbeat stream with `STARTING` phase immediately after the runner process is spawned — before any runtime bootstrap begins. Once the Python agent process starts successfully, the CLI transitions the phase to `READY`. The server, SDK, and desktop UI all recognize and display this phase appropriately.

## Implementation Details

### Proto Layer
- Added `RUNNER_PHASE_STARTING = 6` to `apis/ai/stigmer/agentic/runner/v1/enum.proto`
- Updated transition diagram comments to document all valid transitions involving `STARTING`
- Regenerated stubs across both `stigmer` (Go, TypeScript, Java, Python) and `stigmer-cloud` (Go, TypeScript, Java, Python, Dart) repositories

### Server — Heartbeat Controller
- Updated `isReactivation` logic in `heartbeat.go` to recognize `STARTING` as an active-transition phase
- `PENDING/STOPPED → STARTING` correctly sets `started_at` and clears `stopped_at`
- `STARTING → READY` transitions cleanly when bootstrap completes

### CLI — Runner Stream Client
- Added `InitialPhase` to `RunnerStreamConfig` for configuring the phase at stream creation
- Added `SetPhase()` method with mutex-protected `currentPhase` and a `phaseChanged` channel
- `streamLoop` sends an immediate heartbeat when the phase changes (no waiting for the next tick)

### CLI — Runner Startup
- Restructured `startNativeRunner` to open the heartbeat stream (with `STARTING`) before `BootstrapPythonRuntime()`
- After `startPythonProcess()` succeeds, calls `rsc.SetPhase(RUNNER_PHASE_READY)`
- Bootstrap failure cancels the stream context, allowing the server to detect the failed start

### React SDK
- Added `STARTING` to `PHASE_SORT_ORDER`, `LABELS`, `isTransitionalPhase()`, and `phaseDotColor()`
- Updated `RunnerListPanel` `PhaseBadge` with a CSS spinner for `STARTING`
- Unit tests updated

### Desktop UI
- `PhaseBadge` in `RunnersPage.tsx` shows `Loader2` spinner with primary color for `STARTING`
- Reduced `RESTART_GRACE_MS` from 30s to 10s (the explicit `STARTING` phase makes the long grace unnecessary)

## Benefits

- **Clear user feedback**: Users see "Starting" with a spinner for the entire bootstrap duration — no more false "Stopped" status
- **Server-side observability**: The platform can now distinguish between "actively bootstrapping" and "genuinely stopped" runners
- **Reduced client-side heuristics**: The `RESTART_GRACE_MS` timer was reduced from 30s to 10s since the server-authoritative `STARTING` phase handles the bootstrap window
- **Cross-surface consistency**: Desktop app, web console, and API all see and display the same `STARTING` phase

## Impact

- **Desktop app**: Users clicking "Start Runner" see a continuous spinner until the runner is fully operational
- **Web console**: Same spinner behavior via the shared React SDK `PhaseBadge`
- **API consumers**: Can query runner phase and receive `STARTING` for runners in bootstrap
- **All runner types**: Both Python agent-runner and Node.js cursor-runner bootstraps are covered

## Related Work

- `2026-05-01-101548-fix-dev-mode-runner-startup-delay.md` — Content-hashed build version to eliminate redundant runtime re-bootstrapping in dev mode
- `2026-04-30-211323-fix-runner-start-blocking-and-polling-race.md` — Async cursor-runner bootstrap and UI polling grace period

---

**Status**: Production Ready
**Timeline**: Single session
