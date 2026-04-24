# sendCommand API for UI-Triggered Runner Commands

**Date**: April 22, 2026

## Summary

Added a `sendCommand` unary RPC to `RunnerCommandController` that allows the web UI and API callers to send typed commands (e.g., ListDirectory for workspace browsing) to a connected runner and receive the response synchronously. Implemented in both OSS (Go) and Cloud (Java) with identical error contracts, plus a fix for a latent Redis coordinator bug.

## Problem Statement

With T02–T06 of the runner command stream project complete, the bidi stream infrastructure was fully operational: runners connect, heartbeats flow, and the server can push commands. However, there was no external API for the web UI to trigger commands on a runner. The stream registry's `SendCommand` methods were implemented and tested but had no caller — the final piece of the pipeline was missing.

### Pain Points

- The session composer's workspace picker needed a way to browse a runner's filesystem
- No gRPC endpoint existed for external callers to send commands to runners
- The existing stream infrastructure was fully wired but had no public API surface
- A latent bug in the Redis coordinator would cause cross-instance command failures to silently time out instead of failing fast

## Solution

Added a `sendCommand` unary RPC with a dedicated `RunnerSendCommandInput` message type that wraps the command payload with a `runner_id`. The server validates the request, verifies the runner exists and is in an operable phase, generates a unique `request_id`, pushes the command through the bidi stream, and returns the runner's response. In Cloud, the handler uses a local-first routing strategy (direct local registry before Redis pub/sub) to minimize latency.

## Implementation Details

### Proto Changes
- **`RunnerSendCommandInput`** in `io.proto`: `runner_id` + `oneof command` (mirrors `RunnerCommandRequest.command` without exposing the stream-internal `request_id`)
- **`sendCommand` RPC** in `command.proto`: authorized with `can_view` on the runner resource via `rpc.config`

### OSS Go Handler (`send_command.go`)
- Validates input (runner_id required, command oneof set)
- Loads runner from store — `NOT_FOUND` if missing
- Phase gate: STOPPED/PENDING/FAILED get specific `FAILED_PRECONDITION` errors
- 10-second context timeout
- Builds `RunnerCommandRequest` with UUID, delegates to `StreamRegistry.SendCommand`

### Cloud Java Handler (`RunnerSendCommandHandler.java`)
- Implements `OperationHandlerV2` directly (not CRUD pipeline)
- FGA `can_view` authorization check
- Local-first routing: `isConnectedLocally()` → local send, else Redis coordinator
- Identical error contract to Go handler

### Redis Coordinator Fix
- `InboundCommandListener.onMessage()` now publishes a `RunnerCommandError` response to Redis when `sendCommandLocally` fails, instead of silently swallowing the exception

## Benefits

- **Unblocks web UI workspace picker**: session composer can now browse runner filesystems via a proper gRPC API
- **Consistent error reporting**: nine distinct error cases with specific gRPC status codes and user-facing messages, identical across both editions
- **Fast failure on cross-instance errors**: Redis coordinator fix eliminates 10-second timeout hangs when a runner disconnects during command routing
- **Local-first routing**: avoids unnecessary Redis round-trip when the API handler and runner stream share a pod

## Impact

- **Web UI**: workspace picker in the session composer can now call `sendCommand` to list directories on any connected runner
- **CLI/SDK**: the `sendCommand` RPC is available through all generated client SDKs (Go, TypeScript, Python, Java, Dart)
- **Platform operators**: no new infrastructure requirements — uses existing bidi stream and Redis pub/sub

## Related Work

- T02–T06 of `20260422.02.runner-command-stream` (the bidi stream infrastructure this API builds on)
- `20260422.01.runner-ux-cli-restructure` T08/T09 (web UI workspace picker that will consume this API)
- SDK codegen gap for bidi streaming RPCs (manual fix re-applied; separate tool patch needed)

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
