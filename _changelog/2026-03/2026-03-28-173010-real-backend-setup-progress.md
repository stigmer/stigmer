# Real Backend-Reported Setup Progress

**Date**: March 28, 2026

## Summary

Replaced the fabricated, timer-driven setup progress messages shown during `EXECUTION_PENDING` with real, server-reported phases from the agent-runner. The backend now sends progressive `UpdateStatus` calls at meaningful setup boundaries (sandbox init, workspace provisioning, environment configuration, skill loading, MCP server connection), and the React SDK component renders them directly with a graceful timer-based fallback for older backends.

## Problem Statement

When a user starts an execution, the frontend displays "Initializing execution...", "Preparing agent environment...", "Almost ready..." — all fabricated strings cycling on a fixed 4-second `setTimeout`. The backend already tracks ~10 discrete setup phases via Temporal heartbeats, but none of this information reaches subscribers. The result: a dishonest UI that shows activity unrelated to what the system is actually doing.

### Pain Points

- Progress messages are **fabricated** — they don't reflect real backend state
- Users have no visibility into **which** setup step is taking time (sandbox creation? git clone? MCP server connection?)
- The 4-second timer creates a misleading sense of progress regardless of actual speed
- Platform builders embedding `<SetupProgress />` get fake status messages in their products

## Solution

Added a first-class `SetupProgress` proto message on `AgentExecutionStatus`, with the agent-runner emitting real phase labels via gRPC `UpdateStatus` at ~5 meaningful setup boundaries. The React component prefers server-reported phases when available, falling back to the timer for backward compatibility.

## Implementation Details

### Proto (Layer 1)

- Added `SetupProgress` message with `current_phase` string field to `agentexecution/v1/api.proto`
- Added `setup_progress` field (number 18) to `AgentExecutionStatus`
- Designed as a sub-message for future extensibility (`completed_phases`, `total_phases`)
- Ran `make protos` in both stigmer (OSS) and stigmer-cloud to regenerate all stubs

### Server Merge Logic (Layer 2)

- **Go** (`update_status.go`): Added merge logic — replace `setup_progress` when present, defense-in-depth clear when phase leaves `PENDING`
- **Java** (`AgentExecutionUpdateStatusHandler.java`): Identical merge pattern using `hasSetupProgress()` / `setSetupProgress()` / `clearSetupProgress()`

### Python Worker (Layer 3)

- Added `report_setup_progress()` async helper in `temporal_helpers.py` — best-effort, catches all exceptions (never aborts setup)
- Inserted 5 calls in `execute_graphton.py` at user-meaningful phase boundaries:
  - "Initializing sandbox…" (after `sandbox_init`)
  - "Setting up workspace…" (before `workspace_provisioning`, only if workspace entries exist)
  - "Configuring environment…" (after `environment_merged`)
  - "Loading skills…" (after `skills_written`, only if skills exist)
  - "Connecting tools…" (after `mcp_servers_transformed`, only if MCP servers exist)

### React SDK (Layer 4)

- `SetupProgress.tsx`: Added `serverPhase` prop — when non-empty, renders directly and disables timer
- `MessageThread.tsx`: Extracts `setupProgress.currentPhase` from execution status and threads it through to `<SetupProgress />`

## Benefits

- **Honest UX**: Users see what the backend is actually doing, not fabricated text
- **Debuggability**: When setup is slow, users can see *which* phase is taking time
- **Backward compatible**: Old backends → timer fallback; old frontends → ignore unknown field
- **Extensible**: `SetupProgress` sub-message supports future checklist UI without breaking changes
- **Best-effort**: Setup progress failures never abort the activity — Temporal heartbeats remain the primary liveness mechanism

## Impact

- **Users**: See real setup status instead of fabricated messages
- **Platform builders**: `<SetupProgress />` renders genuine backend state in embedded contexts
- **Operators**: Debug log includes `has_setup_progress` for observability
- **Cross-repo**: Both OSS (Go server) and Cloud (Java server) merge logic updated in lock-step

## Related Work

- SetupProgress component was created with this gap documented inline (line 65-67 of the original file)
- Temporal heartbeats (`heartbeat_during_setup`) remain unchanged — setup progress is additive

---

**Status**: ✅ Production Ready
