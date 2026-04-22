# Implement Bidi Stream Handler for Runner Commands (T04)

**Date**: April 22, 2026

## Summary

Implemented the server-side `RunnerCommandController.connect` bidi gRPC stream handler in stigmer-server (Go) — the first bidirectional streaming RPC in this codebase. This establishes the server's ability to accept persistent connections from runners, process heartbeats over the stream, and route server-initiated commands (e.g., filesystem browsing) to connected runners.

## Problem Statement

With the unary heartbeat RPC deleted in T02 and the Python heartbeat code removed in T03, the server had no way to process runner liveness or route commands. The `heartbeat.go` handler referenced the deleted `RunnerHeartbeatInput` type, causing a compilation failure. The server needed a bidi stream handler to:

- Accept persistent runner connections
- Process heartbeats (runner liveness, phase transitions, connection info)
- Provide a command routing mechanism for server-initiated operations (e.g., `ListDirectory` for workspace browsing)

### Pain Points

- Server compilation broken: `heartbeat.go` referenced deleted `RunnerHeartbeatInput` proto type
- No mechanism for server-to-runner communication (only runner-to-server existed)
- No in-memory tracking of which runners are connected and reachable

## Solution

Three new components in `backend/services/stigmer-server/pkg/domain/runner/controller/`:

1. **StreamRegistry** (`stream_registry.go`) — In-memory registry tracking active bidi streams by runner ID, with thread-safe command send/response routing
2. **Connect handler** (`connect.go`) — Bidi stream handler implementing authentication, heartbeat processing, command response routing, and disconnect cleanup
3. **Refactored heartbeat logic** (`heartbeat.go`) — Pure domain function `applyHeartbeat` preserved with new `RunnerHeartbeat` type; unary `Heartbeat()` handler deleted

## Implementation Details

### StreamRegistry

- `sync.RWMutex` on the streams map (read-heavy: `IsConnected`, `SendCommand` lookup; write-rare: `Register`, `Unregister`)
- Per-entry `sendMu` for serializing `stream.Send()` calls (grpc-go: concurrent Send is unsafe)
- Per-entry pending request map (`request_id → response channel`) for correlating commands with responses
- `Register` replaces stale entries (fast runner restart support)
- `SendCommand` blocks until response or context deadline — ready for T07's `sendCommand` RPC
- `drainPending` closes all waiting channels on disconnect, unblocking callers

### Connect Handler

Four-phase stream lifecycle:

1. **Authentication**: First message must be a `RunnerHeartbeat`. Validates runner_id, loads runner from store, processes the heartbeat.
2. **Registration**: Stream registered in the registry (may evict stale entry from a fast restart).
3. **Recv loop**: Heartbeats update runner status via `applyHeartbeat`; command responses are routed via `DeliverResponse`. Terminal errors (NOT_FOUND, FAILED_PRECONDITION) close the stream; transient errors are logged and the stream continues.
4. **Disconnect cleanup** (deferred): Unregisters stream, transitions runner to STOPPED using `context.Background` (stream context is already cancelled).

### Key Design Decisions

- **Immediate STOPPED on disconnect** (no 90s grace period in OSS) — single server instance means a broken stream is genuinely unreachable; reactivation via heartbeat already handles reconnection
- **Replace on dual-connect** — if a runner reconnects fast, the new stream evicts the old entry; the old stream's recv loop exits naturally
- **runner_id mismatch rejection** — a different runner_id on an established stream is a protocol violation

### Heartbeat Refactoring

- Deleted the `Heartbeat(ctx, *RunnerHeartbeatInput)` unary handler (references deleted proto type)
- Changed `applyHeartbeat` parameter from `*RunnerHeartbeatInput` to `*RunnerHeartbeat` — identical field signatures (`GetRunnerId()`, `GetPhase()`, `GetCurrentExecutions()`, `GetConnectionInfo()`)
- New `processHeartbeat` method in `connect.go` wraps `store.UpdateResource` + `applyHeartbeat` for use from the stream recv loop

## Benefits

- **Resolves T02 compilation failure**: stigmer-server builds cleanly (77 targets pass)
- **Enables server-to-runner commands**: `StreamRegistry.SendCommand` is the foundation for T07's `sendCommand` RPC and the workspace picker UI
- **Clean separation**: Pure heartbeat domain logic (`applyHeartbeat`) separated from transport (stream handler), making it testable and reusable
- **Robust lifecycle**: Handles fast restarts, transient errors, graceful shutdown, and runner deletion while stream is open

## Impact

- **stigmer-server**: All 77 build targets pass (including test compilation)
- **Remaining known failures** (expected, per T01 plan):
  - `client-apps/cli/` — calls `client.Runner.Heartbeat()` (resolved in T05)
  - `stigmer-cloud` Java service — implements deleted heartbeat handler (resolved in T06)

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `controller/stream_registry.go` | Created | +232 |
| `controller/connect.go` | Created | +243 |
| `controller/heartbeat.go` | Refactored | -66, +8 (net -58) |
| `controller/runner_controller.go` | Modified | +12 |
| `controller/BUILD.bazel` | Modified | +5 |

## Related Work

- **T02** (`9e3f5cb48`): Proto & codegen — defined the `connect` RPC and stream message types
- **T03** (`50eb11559`): Deleted Python heartbeat and local FS hack
- **T05** (next): CLI daemon stream client — will consume this handler
- **T07** (future): `sendCommand` RPC — will use `StreamRegistry.SendCommand`

---

**Status**: Production Ready
**Timeline**: Part of the runner-command-stream project (20260422.02)
