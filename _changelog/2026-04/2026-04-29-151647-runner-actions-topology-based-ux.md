# Runner Actions Topology-Based UX

**Date**: April 29, 2026

## Summary

Replaced the binary `isLocal` runner classification with a topology-aware system that correctly determines which actions (Start, Stop, View Logs) are available for each runner based on how and where it was started. This fixes three UX gaps: logs disappearing on crash, no log access for CLI-started runners, and action buttons appearing for remote runners where they don't apply.

## Problem Statement

The Runners page in the desktop app used a simple boolean `isLocal` to decide what actions to show. This led to incorrect behavior across the four runner topologies (local native, local Docker, remote native, remote Docker).

### Pain Points

- When a runner crashed (exit code 1), the error banner said "Check the runner logs for details" but the View Logs button disappeared because it required `isLocal && active`. The log file survived the crash on disk, but the UI had no way to surface it.
- CLI-started runners (`stigmer up` from a terminal) had log files at `~/.stigmer/runners/<name>.log` but the desktop app couldn't detect them after the process died because `read_all_runner_states()` deletes the `.json` state file when the PID is no longer alive.
- The Start button appeared for every STOPPED runner, including remote ones on other machines where starting makes no sense. Stop appeared for daemon-managed runners where per-runner stop isn't the right action.

## Solution

Introduced a `RunnerTopology` classification with five variants — `desktop-managed`, `local-cli`, `local-daemon`, `remote`, and `stopped-local` — derived from three data sources: the Tauri ProcessManager (in-memory), local state files (`~/.stigmer/runners/*.json`), and a new log file existence probe.

## Implementation Details

### Runner Topology Type

```typescript
type RunnerTopology =
  | "desktop-managed"    // spawned by THIS desktop session
  | "local-cli"          // started from CLI on this machine
  | "local-daemon"       // part of full daemon on this machine
  | "remote"             // runner is on another machine
  | "stopped-local";     // was local, now stopped, log file exists
```

### Topology Derivation

The classification is derived from the combined data sources:

1. If the runner is in the Tauri ProcessManager (in-memory) → `desktop-managed`
2. If it has a local state file with `managed_by_daemon` → `local-daemon`
3. If it has a local state file without daemon flag → `local-cli`
4. If the runner is stopped but a log file exists on disk → `stopped-local`
5. Otherwise → `remote`

### Action Matrix

| Topology | Phase | Actions |
|----------|-------|---------|
| desktop-managed | READY/BUSY | Stop, View Logs |
| local-cli | READY/BUSY | Stop, View Logs |
| local-daemon | READY/BUSY | View Logs |
| any-local | STOPPED | Start, View Logs |
| stopped-local | STOPPED | Start, View Logs |
| remote | any | (none) |

### New Tauri Command

Added `check_runner_log_exists` — a lightweight filesystem probe that checks whether `~/.stigmer/runners/<name>.log` exists. This enables the frontend to discover crash logs for stopped runners whose `.json` state file has already been cleaned up by the Rust sidecar.

**Files**: `sidecar.rs`, `lib.rs`, `tauri.ts`

### Unified Action Rendering

Replaced the two separate conditional blocks (`isLocal && active` for logs/stop, `phase === STOPPED` for start) with a single `{hasActions && ...}` block using topology-derived predicates (`canViewLogs`, `canStop`, `canStart`).

**Files**: `RunnersPage.tsx`

## Benefits

- **Crash diagnostics**: Users can now view runner logs after a crash directly from the desktop app, making the "Check the runner logs" error message actionable.
- **CLI runner parity**: Runners started from `stigmer up` in a terminal have the same log access as desktop-spawned runners.
- **Topology-correct actions**: Remote runners no longer show misleading Start/Stop buttons. Daemon-managed runners correctly hide the per-runner Stop button.
- **Zero breaking changes**: The `RunnerLogViewer` and `useRunnerLogs` hook required no changes — the existing Tier 2 file-tail fallback already handles stopped runners.

## Impact

- **Desktop app**: Runner rows now show contextually appropriate actions based on topology. The "Local" badge appears for all local topologies.
- **Desktop Tauri layer**: New `check_runner_log_exists` command registered. No changes to existing commands.
- **Existing behavior preserved**: The `useRunnerLogs` hook's two-tier strategy (ProcessManager buffer → file tail) continues to work unchanged.

## Related Work

- Runner log viewer file-based fallback (2026-04-27) established the Tier 2 file-tail mechanism this change relies on.
- Desktop runners page UX redesign (2026-04-27) introduced the current runner row layout.
- Workspace selector UX upgrade (2026-04-29) established the four-topology model referenced in this design.

---

**Status**: Production Ready
**Timeline**: 1 session
