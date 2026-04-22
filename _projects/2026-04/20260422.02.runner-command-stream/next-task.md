# Next Task: 20260422.02.runner-command-stream

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.02.runner-command-stream

**Description**: Implement a bidirectional gRPC stream between the Runner supervisor (Go) and Stigmer Server, replacing the unary heartbeat RPC and enabling server-initiated commands like filesystem browsing for workspace selection in session creation.
**Goal**: Establish a persistent bidi gRPC stream from the Runner to the server that carries heartbeats (runner to server) and server-initiated commands (server to runner, e.g., ListDirectory). Phase 1 covers agent runner only; workflow runner integration is deferred.
**Tech Stack**: Go (runner supervisor/CLI daemon), Protobuf (stream proto definitions), Java (stigmer-service stream handler)
**Components**: apis/ai/stigmer/agentic/runner/v1/ (proto); client-apps/cli/internal/cli/daemon/ (Go supervisor); backend/services/stigmer-server/ (Go stream handler); stigmer-cloud/backend/services/stigmer-service/ (Java stream handler)

## Current State
- **Status**: T04 complete, ready for T05 or T06
- **Last Session**: 2026-04-22 — T04 implemented (OSS bidi stream handler)
- **Active Task**: T05 (Go Client in CLI Daemon) or T06 (Cloud Server Handler — Java)

## Session Progress (2026-04-22, Session 1)
- Reviewed T01 plan and confirmed key decisions
- Implemented T02: Proto & Codegen
  - Deleted `heartbeat` RPC and `RunnerHeartbeatInput` from runner proto
  - Added `connect` bidi stream RPC to `RunnerCommandController`
  - Added 9 new message types for stream envelope, heartbeat, and commands
  - Enriched `ListDirectoryResponse` with `home_directory`, `current_directory` and `DirectoryEntry.is_hidden`
  - Ran codegen in stigmer (`make codegen`) and stigmer-cloud (`make protos`)
  - Fixed SDK Go codegen bug: manually fixed `sdk/go/internal/gen/runner.go` for bidi stream

## Session Progress (2026-04-22, Session 2)
- Implemented T03: Delete Python Heartbeat + Local FS Hack
  - Deleted `heartbeat.py`, `runner_client.py` (Python heartbeat)
  - Deleted `api_fs.go` (Go HTTP FS handler)
  - Deleted `useFolderListing.ts`, `FolderBrowser.tsx` (React components)
  - Cleaned `worker.py`, `config.py`, `idle_watchdog.py`, `execution_tracker.py` (Python)
  - Cleaned `handler.go`, `BUILD.bazel` (Go)
  - Cleaned `WorkspaceEditor.tsx`, `SessionComposer.tsx`, barrel exports (React SDK)
  - Cleaned `SessionLauncher.tsx`, `SessionPage.tsx`, `next.config.ts` (web app)
  - Regenerated docs via `make gen-react-sdk-docs` pipeline
  - Net: -1,404 lines across 21 files
  - Surprise: `SessionComposer.tsx` not in T01 plan but required update (threads `enableFolderBrowser`)

## Session Progress (2026-04-22, Session 3)
- Implemented T04: OSS Server Handler (Go)
  - Created `stream_registry.go` — in-memory stream registry with Register/Unregister/SendCommand/DeliverResponse
    - `sync.RWMutex` on streams map, per-entry `sendMu` for stream.Send serialization
    - Pending request map (`request_id → response channel`) for command correlation
    - Replace-on-dual-connect: new stream evicts stale entry (fast restart support)
    - `SendCommand` blocks until response or context deadline — ready for T07
  - Created `connect.go` — bidi stream handler (first in codebase)
    - Phase 1: Authentication (first heartbeat validates runner_id + loads from store)
    - Phase 2: Registration in StreamRegistry
    - Phase 3: Recv loop dispatches heartbeats and command responses
    - Phase 4: Deferred disconnect cleanup (Unregister + STOPPED transition)
    - Terminal errors (NOT_FOUND, FAILED_PRECONDITION) close stream; transient errors continue
  - Refactored `heartbeat.go` — deleted `Heartbeat()` unary handler, changed `applyHeartbeat` param to `*RunnerHeartbeat`
  - Modified `runner_controller.go` — added `streamRegistry` field, constructor init, `GetStreamRegistry()` getter
  - Updated `BUILD.bazel` — gazelle resolved new deps (uuid, grpc, codes)
  - Resolved known compilation failure: `heartbeat.go` no longer references deleted `RunnerHeartbeatInput`
  - All 77 stigmer-server build targets pass

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Proto & Codegen | **Complete** | None |
| T03 | Delete Python Heartbeat + Hacky Local FS Endpoint | **Complete** | T02 |
| T04 | OSS Server Handler (Go) | **Complete** | T02 |
| T05 | Go Client in CLI Daemon | Pending | T04 |
| T06 | Cloud Server Handler (Java) | Pending | T02 |
| T07 | API for UI to Trigger Commands | Pending | T04, T06 |
| T08 | Integration Testing | Pending | T05, T07 |

## Next Steps
1. **T05 and T06 can proceed in parallel** (Go CLI daemon client and Java cloud server are independent)
2. **T05** — Implement stream client in Go CLI daemon: open bidi stream after `apply`, send heartbeats, handle commands, reconnect with exponential backoff
3. **T06** — Implement `connect` stream handler in stigmer-service (Java) with Redis pub/sub for cross-instance coordination
4. After both: **T07** — Add `sendCommand` unary RPC that delegates to `StreamRegistry.SendCommand`

## Key Architectural Decisions

1. **Bidi stream replaces unary heartbeat**: `RunnerCommandController.connect` is the runner's only ongoing channel. Heartbeats flow runner-to-server; commands flow server-to-runner.
2. **Typed envelope with oneof**: `RunnerStreamClientMessage` and `RunnerStreamServerMessage` carry typed messages. No `google.protobuf.Any`, no command bus. Adding a command = adding to the proto oneof.
3. **First heartbeat authenticates**: The first message on a new stream MUST be a `RunnerHeartbeat`. Server validates runner_id ownership.
4. **Enriched ListDirectoryResponse**: Includes `home_directory`, `current_directory`, and `is_hidden` on `DirectoryEntry` — preserves UI feature parity with the deleted `api_fs.go` endpoint.
5. **SDK codegen gap**: `stigmer-codegen` tool doesn't handle bidi streaming RPCs. Manual fix applied to `sdk/go/internal/gen/runner.go`. Tool needs a patch (separate task).
6. **Immediate STOPPED on disconnect (OSS)**: No grace period — single server instance means a broken stream is genuinely unreachable. Reactivation via heartbeat handles reconnection. Cloud (T06) may use a grace period.
7. **Replace on dual-connect**: If a runner reconnects fast, the new stream evicts the old entry. No ALREADY_EXISTS rejection.
8. **runner_id mismatch rejection**: A different runner_id on an established stream is INVALID_ARGUMENT — one stream, one runner identity.

## Known Compilation Failures (Expected)

These will be resolved as subsequent tasks are completed:
- `client-apps/cli/internal/cli/runner/start.go` — calls `client.Runner.Heartbeat()` (resolved in T05)
- stigmer-cloud Java service — implements deleted heartbeat handler (resolved in T06)

## Key Files

### Proto (modified in T02)
- `apis/ai/stigmer/agentic/runner/v1/command.proto` — `connect` bidi stream RPC
- `apis/ai/stigmer/agentic/runner/v1/io.proto` — all stream/command message types
- `apis/ai/stigmer/agentic/runner/v1/api.proto` — updated doc comments
- `apis/ai/stigmer/agentic/runner/v1/enum.proto` — updated doc comment

### SDK (manually fixed in T02)
- `sdk/go/internal/gen/runner.go` — bidi stream wrapper (Send/Recv/CloseSend)

### Server (completed in T04)
- `backend/services/stigmer-server/pkg/domain/runner/controller/connect.go` — bidi stream handler
- `backend/services/stigmer-server/pkg/domain/runner/controller/stream_registry.go` — in-memory stream registry
- `backend/services/stigmer-server/pkg/domain/runner/controller/heartbeat.go` — refactored heartbeat domain logic
- `backend/services/stigmer-server/pkg/domain/runner/controller/runner_controller.go` — controller with StreamRegistry

### CLI Daemon (T05 target)
- `client-apps/cli/internal/cli/daemon/runner_stream.go` — new stream client
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — stream lifecycle integration

## Context for Resume
- T01 plan is at `_projects/2026-04/20260422.02.runner-command-stream/tasks/T01_0_plan.md`
- This project coordinates with `20260422.01.runner-ux-cli-restructure` — T08/T09 (web UI) of that project depend on T07 of this project (sendCommand API)
- Both repos are on `feat/secrets-vault-migration` branch
- T02 changes committed: `9e3f5cb48 feat(apis/runner): add bidi command stream proto, delete unary heartbeat`
- T03 changes committed: `50eb11559 refactor: delete Python heartbeat and local FS hack (T03)`
- T04 changes ready to commit (this session)
- Python heartbeat code is fully deleted — the Go daemon (T05) will own heartbeat over the bidi stream
- Local FS hack fully deleted — `ListDirectory` over bidi stream (T04-T07) replaces it
- `StreamRegistry.SendCommand` is fully implemented and ready for T07's `sendCommand` RPC handler

## Blockers
- None for T05 or T06

## Quick Commands
- "Start T05" — Implement Go CLI daemon stream client
- "Start T06" — Implement Cloud server connect handler (Java)
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
