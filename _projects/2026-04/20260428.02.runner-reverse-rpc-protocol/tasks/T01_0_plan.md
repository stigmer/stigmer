# Task T01: Replace Hand-Rolled Command Protocol with gRPC Reverse Tunnel

**Created**: 2026-04-28
**Status**: PENDING REVIEW
**Type**: Refactoring

## Problem Statement

The runner's `connect` bidi stream currently carries a hand-rolled request-response protocol:
- **`oneof command` bags** in `RunnerCommandRequest`, `RunnerSendCommandInput`, and `RunnerCommandResponse` serve as a manual service definition.
- **`StreamRegistry`** (245 lines) reimplements gRPC's native request-response correlation, send serialization, timeout handling, and connection lifecycle.
- **`request_id`** correlation manually pairs requests to responses via Go channels.
- **Adding a new command** requires touching 5 places: two `oneof` definitions, `dispatchCommand()` switch, `buildCommandRequest()` switch, and the response `oneof`.

This works but is an ad-hoc protocol where a well-known abstraction exists. A gRPC reverse tunnel would give the same topology (runner-initiated outbound connection, server pushes RPCs) with codegen'd dispatch, native error handling, and standard tooling.

## Current Architecture (What Gets Replaced)

```
io.proto:
  RunnerSendCommandInput     → oneof command { ListDirectoryRequest, ... }
  RunnerStreamClientMessage  → oneof { heartbeat, command_response }
  RunnerStreamServerMessage  → oneof { command_request }
  RunnerCommandRequest       → request_id + oneof command { ListDirectory, Stop }
  RunnerCommandResponse      → request_id + oneof result { ListDirectory, error, Stop }

command.proto:
  RunnerCommandController.connect()      → bidi stream (carries heartbeats + commands)
  RunnerCommandController.sendCommand()  → unary (UI → server → stream → runner → stream → server → UI)

Server:
  stream_registry.go   → Register/Unregister/SendCommand/DeliverResponse
  send_command.go      → validateRunnerPhase + buildCommandRequest
  connect.go           → recvLoop dispatches heartbeats vs command_responses

CLI Daemon:
  runner_stream.go          → recvLoop reads server messages, calls dispatchCommand
  runner_stream_commands.go → dispatchCommand switch + handleListDirectory + handleStop
```

## Target Architecture

### New proto service: `RunnerLocalService`

Define a proper gRPC service for operations the server invokes on the runner:

```protobuf
service RunnerLocalService {
  rpc ListDirectory(ListDirectoryRequest) returns (ListDirectoryResponse);
  rpc Stop(StopRunnerRequest) returns (StopRunnerResponse);
  // Future commands: just add methods here. No oneof, no switches.
}
```

### Reverse tunnel pattern

The runner opens an outbound gRPC connection to the server. Through a reverse tunnel mechanism, the runner registers itself as a `RunnerLocalService` server on that connection. The Stigmer server can then call `RunnerLocalService.ListDirectory()` as a normal unary RPC — the tunnel carries the call over the runner-initiated connection.

### What stays

- **Heartbeat stream** — the `connect` bidi stream continues to carry heartbeats (runner → server). Heartbeats are a presence/liveness concern, not an RPC pattern.
- **`sendCommand` unary RPC** — the UI-facing API may remain as a thin proxy that calls `RunnerLocalService` methods through the tunnel, or it may be refactored to call the reverse-tunneled service directly.
- **`ListDirectoryRequest`/`ListDirectoryResponse`/`DirectoryEntry`** messages — these are correct domain messages and stay as-is.

### What gets removed

- `RunnerCommandRequest` / `RunnerCommandResponse` (the envelope with `request_id` and `oneof`)
- `RunnerSendCommandInput.command` oneof (replaced by typed RPC methods)
- `StreamRegistry` (replaced by reverse tunnel connection management)
- `dispatchCommand()` and `buildCommandRequest()` switches
- `RunnerStreamServerMessage.command_request` (commands no longer flow on the heartbeat stream)

## Task Breakdown

### Phase 1: Feasibility and Library Evaluation

1. **Evaluate reverse tunnel libraries**
   - [ ] Assess `jhump/grpctunnel` for Go-native gRPC
   - [ ] Assess compatibility with Connect-RPC (browser transport uses Connect, not raw gRPC)
   - [ ] Assess alternatives: `grpc-go` channel-based approach, custom lightweight tunnel
   - [ ] Determine if the tunnel can coexist with the existing `connect` stream (heartbeats stay on bidi, RPCs go through tunnel) or if heartbeats should also move

2. **Cloud routing assessment**
   - [ ] Current: Redis pub/sub relays commands to the pod holding the bidi stream
   - [ ] Target: How does the reverse tunnel handle multi-pod? Does the tunnel connection need to be registered in a shared registry (Redis, etcd)?
   - [ ] Evaluate if a connection-aware load balancer (e.g., consistent hashing by runner_id) eliminates the need for Redis relay

3. **Prototype**
   - [ ] Build a minimal proof-of-concept: runner registers `RunnerLocalService` through a tunnel, server calls `ListDirectory` through it
   - [ ] Verify latency characteristics vs current approach
   - [ ] Verify behavior on connection drop / reconnect

### Phase 2: Proto and Server Changes

4. **Define `RunnerLocalService`**
   - [ ] Add `RunnerLocalService` to `apis/ai/stigmer/agentic/runner/v1/`
   - [ ] Move `ListDirectory` and `Stop` RPCs into this service
   - [ ] Keep request/response messages unchanged
   - [ ] Generate Go and TypeScript stubs

5. **Server-side: replace StreamRegistry with tunnel registry**
   - [ ] Implement tunnel connection management (register/unregister by runner_id)
   - [ ] `sendCommand` handler calls `RunnerLocalService.ListDirectory()` through the tunnel instead of pushing to a stream channel
   - [ ] `stop` handler calls `RunnerLocalService.Stop()` through the tunnel
   - [ ] Remove `StreamRegistry`, `SendCommand`, `DeliverResponse`, `drainPending`
   - [ ] Remove `buildCommandRequest` switch

6. **Heartbeat stream simplification**
   - [ ] `connect` stream carries only heartbeats (no more `command_request` / `command_response`)
   - [ ] Remove `RunnerStreamServerMessage.command_request` and `RunnerStreamClientMessage.command_response`
   - [ ] Simplify `recvLoop` in connect handler — only heartbeat processing

### Phase 3: CLI Daemon Changes

7. **Runner-side: implement `RunnerLocalService`**
   - [ ] Implement `RunnerLocalService` as a proper gRPC server in the CLI daemon
   - [ ] `ListDirectory` handler = current `handleListDirectory` (logic unchanged)
   - [ ] `Stop` handler = current `handleStop` (logic unchanged)
   - [ ] Register through the reverse tunnel on startup
   - [ ] Remove `dispatchCommand` switch and `runner_stream_commands.go` routing

### Phase 4: SDK and UI

8. **SDK changes**
   - [ ] If `sendCommand` unary RPC is preserved as a proxy, SDK changes are minimal (just response shape)
   - [ ] If `sendCommand` is replaced by direct typed RPCs, update `useRunnerFileBrowser.ts` and `sdk/typescript/src/gen/runner.ts`
   - [ ] Ensure Connect-RPC browser transport works end-to-end

### Phase 5: Migration and Cleanup

9. **Backward compatibility**
   - [ ] Support both old (bidi command) and new (reverse tunnel) protocols during rollout
   - [ ] Server detects runner capability via heartbeat metadata (e.g., `supports_reverse_tunnel: true`)
   - [ ] Remove old path after all runners upgrade

10. **Cleanup**
    - [ ] Remove `RunnerCommandRequest`, `RunnerCommandResponse` message types
    - [ ] Remove `RunnerSendCommandInput.command` oneof
    - [ ] Remove `StreamRegistry` and all related test files
    - [ ] Update cloud Redis pub/sub routing (or remove if tunnel handles it)

## Success Criteria for T01

- [ ] Library evaluation complete with a recommendation
- [ ] PoC demonstrates reverse-tunneled `ListDirectory` call working end-to-end
- [ ] Cloud routing strategy defined
- [ ] Connect-RPC compatibility confirmed or workaround identified
- [ ] Migration strategy documented (old/new coexistence)

## Key Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `grpctunnel` incompatible with Connect-RPC | High — browser clients break | PoC must validate browser path before any proto changes |
| Cloud pod routing requires new infrastructure | Medium — delays cloud deploy | Evaluate connection-aware LB vs shared tunnel registry early |
| Old runners break during rollout | High — production outage | Capability flag in heartbeat, dual-path support during migration |
| Tunnel adds latency vs in-process stream dispatch | Low — likely negligible | Measure in PoC |

## Files Affected

| File | Change |
|------|--------|
| `apis/ai/stigmer/agentic/runner/v1/io.proto` | Add `RunnerLocalService`, remove command envelopes |
| `apis/ai/stigmer/agentic/runner/v1/command.proto` | Remove `sendCommand` or simplify to proxy |
| `backend/.../runner/controller/stream_registry.go` | Delete entirely |
| `backend/.../runner/controller/send_command.go` | Rewrite to call tunnel |
| `backend/.../runner/controller/connect.go` | Simplify to heartbeat-only |
| `client-apps/cli/.../daemon/runner_stream_commands.go` | Replace with `RunnerLocalService` impl |
| `client-apps/cli/.../daemon/runner_stream.go` | Remove command dispatch from recvLoop |
| `sdk/react/src/runner/useRunnerFileBrowser.ts` | Minimal or no change |
| `sdk/typescript/src/gen/runner.ts` | Regenerated from protos |

## Review Process

**What happens next**:
1. **You review this plan** — consider feasibility, scope, and risks
2. **Provide feedback** — concerns, scope adjustments, or alternative approaches
3. **I'll revise the plan** — incorporate your feedback into T01_2_revised_plan.md
4. **You approve** — explicit approval to begin Phase 1 (feasibility + PoC)
5. **Execution begins** — tracked in T01_3_execution.md
