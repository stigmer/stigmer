# Runner Command Stream: Proto & Codegen (T02)

**Date**: April 22, 2026

## Summary

Defined the bidirectional gRPC stream proto contract for the runner command stream — the foundation for replacing the unary heartbeat RPC with a persistent bidi stream that carries heartbeats (runner to server) and server-initiated commands (server to runner). This is the first implementation task of the runner-command-stream project (20260422.02).

## Problem Statement

The runner's only communication channel with the server was a unary `heartbeat` RPC called every 30 seconds by the Python agent-runner. All communication was runner-initiated — the server had no way to push commands to the runner. With runners becoming a first-class user-managed resource, the server needs to reach the runner for interactive operations like filesystem browsing during workspace selection in the session composer.

### Pain Points

- Server cannot push commands to runners (no reverse channel)
- Workspace browsing relies on a hacky local-only `GET /api/fs/list` HTTP endpoint
- Local-only filesystem browsing doesn't work for remote runners
- Python-side heartbeat creates a split responsibility (Python sends heartbeats, Go manages lifecycle)

## Solution

Define a typed bidirectional gRPC stream (`RunnerCommandController.connect`) with envelope messages for both directions. The stream carries heartbeats (runner to server) and typed commands (server to runner). The command set is fixed at compile time by proto `oneof` — no arbitrary code execution on the runner.

## Implementation Details

### Proto Changes (4 files)

**command.proto**: Deleted the unary `heartbeat` RPC. Added `connect` bidi stream RPC with full lifecycle documentation (authentication via first heartbeat, 30s heartbeat interval, graceful shutdown protocol, 90s disconnect timeout). Updated `RunnerCommandController` service doc comment.

**io.proto**: Deleted `RunnerHeartbeatInput` message. Added 9 new message types:
- `RunnerStreamClientMessage` / `RunnerStreamServerMessage` — typed envelopes with `oneof` for each direction
- `RunnerHeartbeat` — stream-carried heartbeat (same fields as deleted `RunnerHeartbeatInput`)
- `RunnerCommandRequest` / `RunnerCommandResponse` — request-id correlated command protocol
- `ListDirectoryRequest` / `ListDirectoryResponse` — filesystem browsing command
- `DirectoryEntry` — with `is_hidden` for UI feature parity
- `RunnerCommandError` — typed error response

**api.proto** / **enum.proto**: Updated doc comments referencing the old "heartbeat RPC" to reference the "connect stream".

### Design Decisions

- `ListDirectoryResponse` includes `home_directory` and `current_directory` fields, and `DirectoryEntry` includes `is_hidden` — preserving feature parity with the existing `api_fs.go` endpoint that the `FolderBrowser` UI depends on.
- Heartbeat deletion was done outright (no deprecation period) since all changes are local-only with no live consumers.

### Codegen

Ran `make codegen` in stigmer and `make protos` in stigmer-cloud. All stubs regenerated across Go, Java, Python, TypeScript, and Dart.

### Surprise: SDK Codegen Bidi Stream Bug

The `stigmer-codegen` tool (Go SDK layer) generated incorrect code for the bidi stream — it treated `Connect` as a unary call, passing `*RunnerStreamClientMessage` where `...grpc.CallOption` was expected. Fixed the generated `sdk/go/internal/gen/runner.go` manually with correct `Send`/`Recv`/`CloseSend` wrapper. The codegen tool itself needs a patch for bidi stream support in a future task.

## Benefits

- Type-safe bidirectional communication channel between runner and server
- Extensible command set via proto `oneof` (add new commands with a proto change)
- Foundation for filesystem browsing that works identically for local and remote runners
- Heartbeat ownership moves from Python agent-runner to Go supervisor (single responsibility)

## Impact

- **Proto contract**: Breaking change — `heartbeat` RPC and `RunnerHeartbeatInput` deleted, `connect` stream added
- **Expected compilation failures**: stigmer-server heartbeat handler, CLI runner start, Python heartbeat emitter, stigmer-cloud Java heartbeat handler — all resolved in subsequent T03-T05 phases
- **45 files changed** across stigmer (proto sources + generated stubs in Go, Java, Python, TypeScript)
- **29 files changed** in stigmer-cloud (generated stubs in Go, Java, Python, TypeScript, Dart)

## Related Work

- Part of project `20260422.02.runner-command-stream` (T02 of 8 phases)
- Depends on Runner as a Resource (completed in project `20260420.01`, Sessions 1-18)
- Blocks T08/T09 of `20260422.01.runner-ux-cli-restructure` (web UI runner picker + workspace browsing)
- Next: T03 (delete Python heartbeat + hacky local FS endpoint)

---

**Status**: In Progress (T02 complete, T03-T08 pending)
**Timeline**: T02 completed in 1 session
