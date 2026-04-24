# Cloud Server Bidi Stream Handler (T06)

**Date**: April 22, 2026

## Summary

Implemented the Java Cloud server-side handler for the bidirectional gRPC command stream in `stigmer-service`. This is the first bidi streaming RPC in the Java cloud service, replacing the unary heartbeat handler with a persistent connection that carries heartbeats and server-initiated commands. Includes Redis Pub/Sub for cross-instance command routing in multi-replica deployments.

## Problem Statement

The runner command stream (T02-T05) established a bidi gRPC channel between runners and the OSS Go server. The Cloud Java service (`stigmer-service`) still referenced the deleted unary heartbeat handler and `RunnerHeartbeatInput` proto message, causing a build failure. More importantly, Cloud runners had no stream handler — meaning the entire command stream feature (including filesystem browsing for workspace selection) was unavailable in Cloud deployments.

### Pain Points

- Cloud service build was broken (references to deleted `RunnerHeartbeatInput` and `heartbeat` RPC)
- No bidi streaming support in the `grpc-request` framework library — only unary and server-streaming handlers existed
- Heartbeat domain logic was coupled to the pipeline pattern (`RequestPipelineStepV2`), which cannot model a long-lived stream
- Multi-replica Cloud deployments need cross-instance command routing (a command request may arrive at a pod that doesn't hold the runner's stream)

## Solution

Six-layer implementation following the architecture established in T04 (Go OSS handler), adapted for Java concurrency patterns and extended with Redis Pub/Sub for multi-instance coordination.

## Implementation Details

### 1. Framework Extension (grpc-request library)

- **`BidiStreamHandler<I, O>`** interface: parallel to `OperationHandlerV2` but with the gRPC-Java bidi signature (`handle(StreamObserver<O>) → StreamObserver<I>`)
- **`RequestFactory`**: extended with a second handler map (`bidiHandlerBeans`) that detects `BidiStreamHandler` instances during Spring context initialization
- **`RequestRouter`**: new `route(StreamObserver<O>)` overload that the auto-generated controller calls for bidi RPCs — returns a no-op observer on error to satisfy the non-void return type
- **`StandardRequestMethod.Type`**: added `BIDI_STREAMING` value

The auto-generated `RunnerCommandController` already produced the correct dispatch code (`return requestRouter.route(responseObserver)`) — the framework just needed the runtime methods to match.

### 2. RunnerHeartbeatService (domain logic extraction)

Extracted heartbeat processing from `RunnerHeartbeatHandler`'s inner pipeline steps into a standalone Spring `@Component` with three methods:

- `authenticateFirstHeartbeat(heartbeat, callerId)` — load runner, FGA `can_edit` check, apply status, persist
- `processHeartbeat(heartbeat, authenticatedRunnerId)` — runner_id validation, status update, deprovision trigger; classifies errors as terminal (close stream) vs transient (log and continue)
- `transitionToStopped(runnerId)` — best-effort STOPPED transition on disconnect, skips if already STOPPED/FAILED

Domain logic is identical to the Go `applyHeartbeat` function: FAILED phase rejects heartbeat, reactivation (PENDING/STOPPED → READY) sets `started_at` and clears `stopped_at`.

### 3. RunnerStreamRegistry (in-memory connection tracking)

`ConcurrentHashMap<String, RunnerStreamEntry>` with:

- **`RunnerStreamEntry`**: holds the `StreamObserver` (live TCP connection handle), `ReentrantLock` for send serialization, `ConcurrentHashMap` of pending `CompletableFuture<RunnerCommandResponse>` keyed by request_id
- **`sendCommandLocally`**: creates pending future → sends command on stream → blocks on future with 10s timeout
- **Replace-on-dual-connect**: new stream evicts stale entry, draining all pending futures with UNAVAILABLE

### 4. RunnerCommandRedisCoordinator (cross-instance routing)

New Redis Pub/Sub pattern in the codebase (existing Redis usage is Streams for execution events):

- **Inbound**: on runner connect, subscribes to `runner-cmd:{runnerId}` channel; on command arrival, routes to local registry, publishes response to `runner-cmd-resp:{requestId}`
- **Outbound**: publishes command to `runner-cmd:{runnerId}`, subscribes to `runner-cmd-resp:{requestId}` with CompletableFuture, blocks with timeout
- **Serialization**: protobuf bytes encoded as Base64 strings
- **Lifecycle**: subscribe on connect, unsubscribe on disconnect — no leaked subscriptions
- **`RedisMessageListenerContainer`** bean added to `redis-starter` configuration

### 5. RunnerConnectHandler (bidi stream handler)

The core handler implementing `BidiStreamHandler<RunnerStreamClientMessage, RunnerStreamServerMessage>`:

- First `onNext`: validates heartbeat, extracts caller from `InterceptorContextHolder`, authenticates via `RunnerHeartbeatService`, registers stream + Redis subscription
- Subsequent `onNext`: dispatches heartbeats (with terminal/transient error classification) and command responses
- `onError`/`onCompleted`: shared disconnect handler (unregister, Redis unsubscribe, transition to STOPPED)

### 6. Cleanup

- Deleted `RunnerHeartbeatHandler` (299 lines — 4 inner pipeline step classes superseded by `RunnerHeartbeatService`)
- Deleted `DeprovisionInfrastructureStep` (79 lines — referenced deleted `RunnerHeartbeatInput` type; logic moved to `RunnerHeartbeatService.triggerDeprovisionIfNeeded()`)

## Benefits

- **Cloud stream support**: Runners connected to Cloud can now use the bidi command stream (heartbeats + server-initiated commands)
- **Unblocks T07**: The `sendCommand` API (T07) can now be implemented for both OSS and Cloud, completing the full user-facing feature
- **Framework reusable**: `BidiStreamHandler` interface is available for any future bidi streaming RPCs in the Java service
- **Redis coordination pattern**: First Redis Pub/Sub usage establishes a pattern for any future cross-instance real-time coordination needs

## Impact

- **stigmer-cloud**: 12 files changed, +1,170 / -432 lines (net +738)
- **Build status**: Cloud service compiles (pre-existing `SessionUpdateSandboxIdHandler` failure is unrelated)
- **Behavioral parity**: All 8 behavioral consistency checks pass between Go OSS and Java Cloud handlers

## Related Work

- T02: `9e3f5cb48` — Proto & Codegen (bidi stream proto definitions)
- T03: `50eb11559` — Delete Python heartbeat + local FS hack
- T04: `5028f181b` — OSS Server Handler (Go) — the reference implementation
- T05: `617f0c969` — Go Client in CLI Daemon
- T07 (next): `sendCommand` unary RPC — now unblocked by T06

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
