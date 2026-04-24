# Runner Bidi Stream Client in CLI Daemon and Standalone Runner

**Date**: April 22, 2026

## Summary

Implemented the Go client side of the runner command stream — a persistent bidi gRPC connection from the CLI to the server that replaces the deleted Python heartbeat and enables server-initiated commands. The stream client is integrated into both the daemon process (`stigmer up server`) and the standalone runner (`stigmer up`), with automatic reconnection and graceful shutdown.

## Problem Statement

After T02-T04, the server side of the bidi command stream was complete, but the CLI had no client to connect to it. The standalone runner (`start.go`) still called the deleted `Heartbeat()` unary RPC, causing a compilation failure. Without a stream client, runners had no heartbeat path, no way to receive server commands (like ListDirectory for workspace browsing), and no way to send STOPPED on shutdown.

### Pain Points

- `start.go` would not compile — called `client.Runner.Heartbeat()` which no longer exists
- No heartbeat mechanism after the Python heartbeat was deleted in T03
- No way for the server to push commands (ListDirectory) to the runner
- Two distinct runner lifecycle paths (daemon and standalone) needed the same stream behavior

## Solution

Created `RunnerStreamClient` — a reusable stream client component in the daemon package, integrated into both runner lifecycle paths via a factory function pattern. The client opens the `connect` bidi stream, sends periodic heartbeats, handles incoming commands, and reconnects automatically on stream errors.

## Implementation Details

### Core Component: `RunnerStreamClient`

- **`CommandStream` interface**: abstracts the SDK wrapper and raw gRPC stream behind `Send`/`Recv`/`CloseSend`, allowing the same client to work with both lifecycle paths
- **`Run(ctx)` main loop**: connects via factory, enters heartbeat/recv loop, reconnects on error, returns on context cancellation
- **Heartbeat ticker**: sends `READY` heartbeat every 30s with `RunnerConnectionInfo` (hostname, OS, arch, runner version) under a `sync.Mutex` to serialize sends
- **Recv loop**: dispatches `RunnerCommandRequest` to typed handlers, sends `RunnerCommandResponse` back on the stream
- **Reconnection**: exponential backoff (1s → 2s → 4s → ... → 60s cap) with 25% random jitter to prevent thundering herd
- **Graceful shutdown**: best-effort `STOPPED` heartbeat + `CloseSend` when the context is cancelled

### Command Handlers

- **`dispatchCommand`**: routes by oneof type, logs every command to stdout per the security model ("the user must see what the server requests")
- **`handleListDirectory`**: resolves `~` paths, reads directory via `os.ReadDir`, sorts entries (directories first, then alphabetical), populates `resolved_path`, `home_directory`, `current_directory`, `is_hidden`
- Errors (permission denied, not found) return `RunnerCommandError` without closing the stream

### Daemon Integration (`stigmer up server`)

After `registerEmbeddedRunner`, a dedicated SDK client is created with keepalive and insecure transport. The stream runs in a goroutine tracked by a `sync.WaitGroup`. On shutdown signal, the stream context is cancelled first (sending STOPPED heartbeat), then child processes are stopped.

### Standalone Integration (`stigmer up`)

The stream runs alongside the Python process using the existing SDK client's `Connect` method as the factory. On exit (Python dies or signal received), the stream context is cancelled, the WaitGroup drains, and runner state is cleaned up. The old `sendStoppedHeartbeat` function (which called the deleted unary RPC) is deleted entirely.

## Benefits

- **Compilation fixed**: `start.go` compiles again — the known failure from T02 is resolved
- **Heartbeat restored**: runners report liveness over the bidi stream, replacing the deleted Python heartbeat
- **Commands enabled**: the server can now push `ListDirectory` (and future commands) to connected runners
- **Resilient**: automatic reconnection with backoff handles server restarts, network blips, and rolling deployments
- **Consistent**: identical stream behavior in both daemon and standalone modes via the reusable `RunnerStreamClient`

## Impact

- **CLI daemon**: `stigmer up server` now maintains a persistent command stream for the embedded runner
- **Standalone runner**: `stigmer up` sends heartbeats and handles commands over the bidi stream
- **Server**: can now route commands to OSS runners via `StreamRegistry.SendCommand` (ready for T07)
- **current_executions**: hardcoded to 0 for now — file-based IPC with the Python agent-runner is deferred

## Related Work

- T02: Proto & Codegen (`9e3f5cb48`) — defined the stream RPC and message types
- T03: Delete Python Heartbeat (`50eb11559`) — removed the old heartbeat path
- T04: OSS Server Handler (`5028f181b`) — server-side `connect` handler and `StreamRegistry`
- T07 (next): `sendCommand` unary RPC — will use `StreamRegistry.SendCommand` to push commands to connected runners
- T06 (parallel): Cloud server handler (Java) — mirrors T04 with Redis pub/sub

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
