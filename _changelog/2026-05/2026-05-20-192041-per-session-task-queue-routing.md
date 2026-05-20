# Per-Session Temporal Task Queue Routing

**Date**: May 20, 2026

## Summary

Implemented per-session Temporal activity task queue routing in the OSS control plane. The dispatch function now supports two modes: "global" (shared queue for all sessions, the default) and "session" (per-session queues derived from session IDs). This is the foundational routing infrastructure for the desktop embedded runner and cloud sandbox architectures.

## Problem Statement

After deleting the Runner API resource (T02), dispatch was left with a hardcoded `agent_execution_runner` queue — a temporary placeholder. The architecture requires per-session routing so that:

- Desktop apps can embed a runner per active session (workspace isolation)
- Cloud sandboxes can boot with a session-specific queue (compute isolation)
- The control plane derives queue names by convention (no mutable state to coordinate)

### Pain Points

- Hardcoded queue name blocked per-session runner deployment
- No mechanism to switch between shared-pool and per-session topologies
- MCP connect was coupled to a fixed runner queue string

## Solution

Convention-based queue naming (`session:{session_id}`) controlled by a server-level environment variable (`STIGMER_ACTIVITY_ROUTING=global|session`). The routing mode is a deployment topology property, not a per-session domain concern — no proto changes required.

## Implementation Details

### Dispatch Config (`config.go`)

- Added `ActivityRouting` field to `Config` struct
- New constants: `RoutingGlobal`, `RoutingSession`
- Read from `STIGMER_ACTIVITY_ROUTING` env var (default: `"global"`)

### Dispatch Logic (`dispatch.go`)

- `FormatSessionTaskQueue(sessionID)` — exported pure function returning `"session:" + sessionID`
- `ResolveActivityTaskQueue` now accepts `*Config` and branches on routing mode
- Internal `resolveTaskQueue` helper separates the routing decision cleanly

### Controller Wiring

- `AgentExecutionController` gained `temporalConfig` field and `SetTemporalConfig` setter
- `startWorkflowStep` passes config to dispatch
- `server.go` hoists config creation, wires to both execution and MCP controllers

### MCP Connect Routing

- Replaced `runnerQueue string` field with `temporalConfig *Config`
- `SetConnectDependencies` signature updated to accept config struct
- MCP connect always routes to the global queue (discovery is not session-scoped)

### Tests

- 12 unit tests covering: `FormatSessionTaskQueue`, global routing, session routing, fallback behavior, custom queue configuration

## Benefits

- **Zero-config backward compatibility**: Default `global` mode behaves identically to before
- **Stateless derivation**: Queue name is computed from session ID, not stored — no coordination or stale state
- **Single mechanism for all routing**: Execution dispatch and MCP connect share the same config
- **Extensible**: Adding per-session override (e.g., a proto field) later requires only an additional check in `resolveTaskQueue`

## Impact

- **OSS stigmer-server**: New env var `STIGMER_ACTIVITY_ROUTING` controls routing topology
- **TypeScript runner**: No changes needed — already accepts arbitrary queue names via `STIGMER_TASK_QUEUE`
- **Desktop app (T06)**: Can now set `STIGMER_ACTIVITY_ROUTING=session` on embedded server
- **Cloud control plane (T05)**: Will use the same `session:{id}` convention for sandbox provisioning

## Related Work

- **T02**: Runner API deletion (set up the hardcoded dispatch as placeholder)
- **T03**: `createStigmerRunner()` factory (runner already supports per-session queue names)
- **T05**: Java cloud control plane refactor (will implement `EnsureSessionSandbox` activity)
- **T06**: Desktop app embedded runner (will use per-session mode)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~45 minutes)
