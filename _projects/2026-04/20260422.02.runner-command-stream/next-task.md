# Next Task: 20260422.02.runner-command-stream

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.02.runner-command-stream

**Description**: Implement a bidirectional gRPC stream between the Runner supervisor (Go) and Stigmer Server, replacing the unary heartbeat RPC and enabling server-initiated commands like filesystem browsing for workspace selection in session creation.
**Goal**: Establish a persistent bidi gRPC stream from the Runner to the server that carries heartbeats (runner to server) and server-initiated commands (server to runner, e.g., ListDirectory). Phase 1 covers agent runner only; workflow runner integration is deferred.
**Tech Stack**: Go (runner supervisor/CLI daemon), Protobuf (stream proto definitions), Java (stigmer-service stream handler)
**Components**: apis/ai/stigmer/agentic/runner/v1/ (proto); client-apps/cli/internal/cli/daemon/ (Go supervisor); backend/services/stigmer-server/ (Go stream handler); stigmer-cloud/backend/services/stigmer-service/ (Java stream handler)

## Current State
- **Status**: T07 complete, ready for T08
- **Last Session**: 2026-04-22 — T07 implemented (sendCommand API — Proto + Go + Java)
- **Active Task**: T08 (Integration Testing)

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

## Session Progress (2026-04-22, Session 4)
- Implemented T05: Go Client in CLI Daemon
  - Created `runner_stream.go` — RunnerStreamClient with:
    - `CommandStream` interface abstracting SDK/raw gRPC stream
    - `Run(ctx)` main loop: connect → heartbeat/recv → reconnect on error → return on cancel
    - Exponential backoff: 1s → 2s → 4s → ... → 60s cap with 25% jitter
    - Heartbeat every 30s with RunnerConnectionInfo (hostname, OS, arch, runner version)
    - `sync.Mutex` for Send serialization (matches server-side `sendMu` pattern)
    - Graceful shutdown: best-effort STOPPED heartbeat + CloseSend
  - Created `runner_stream_commands.go` — command dispatch + ListDirectory handler
    - `dispatchCommand`: routes by oneof type, logs every command to stdout
    - `handleListDirectory`: ~ expansion, os.ReadDir, sorted entries, home_directory/current_directory/is_hidden
    - Errors return RunnerCommandError without closing the stream
  - Modified `daemon_process.go` — daemon integration
    - Creates dedicated SDK client after registerEmbeddedRunner
    - Stream goroutine tracked by sync.WaitGroup
    - On shutdown: stream cancelled first (STOPPED heartbeat), then children stopped
  - Modified `runner/start.go` — standalone runner integration
    - Stream runs alongside Python process
    - Deleted `sendStoppedHeartbeat` (called deleted unary RPC) — compilation failure resolved
    - Deleted `shutdown` function — simplified to stream cancel + RemoveState
  - Updated `stop.go` comment to reference bidi stream
  - Updated BUILD.bazel for both daemon and runner packages
  - Full CLI builds cleanly (`go build ./...`), go vet clean, existing tests pass
  - All 77 stigmer-server build targets still pass

## Session Progress (2026-04-22, Session 5)
- Implemented T06: Cloud Server Handler (Java)
  - Extended grpc-request framework with `BidiStreamHandler` interface, `RequestFactory` bidi map, `RequestRouter.route(StreamObserver)` overload
  - Created `RunnerHeartbeatService` — extracted domain logic from 4 pipeline steps into standalone service (authenticate, process, transitionToStopped)
  - Created `RunnerStreamRegistry` — ConcurrentHashMap-based in-memory stream tracking with CompletableFuture-based command routing, ReentrantLock send serialization
  - Created `RunnerStreamEntry` — per-runner connection state (observer, send lock, pending futures)
  - Created `RunnerCommandRedisCoordinator` — Redis Pub/Sub for cross-instance command routing (subscribe on connect, unsubscribe on disconnect, Base64-encoded protobuf)
  - Added `RedisMessageListenerContainer` bean to redis-starter
  - Created `RunnerConnectHandler` — first bidi stream handler in Java service (auth, heartbeat, command dispatch, disconnect)
  - Deleted `RunnerHeartbeatHandler` (299 lines, 4 inner classes) and `DeprovisionInfrastructureStep` (79 lines, referenced deleted `RunnerHeartbeatInput`)
  - Surprise: `DeprovisionInfrastructureStep` not in original delete plan but referenced deleted `RunnerHeartbeatInput` type — logic moved to `RunnerHeartbeatService.triggerDeprovisionIfNeeded()`
  - All T06 code compiles; pre-existing `SessionUpdateSandboxIdHandler` failure is unrelated
  - Auto-generated `RunnerCommandController.java` correctly dispatches `connect` to `RunnerConnectHandler`
  - Net: +1,170 / -432 lines across 12 files

## Session Progress (2026-04-22, Session 7)
- Implemented T07: API for UI to Trigger Commands (sendCommand)
  - Added `RunnerSendCommandInput` message to `io.proto` with `runner_id` + `oneof command` (mirrors `RunnerCommandRequest.command` without exposing stream-internal `request_id`)
  - Added `sendCommand` unary RPC to `command.proto` with `rpc.config` authorization (`can_view` on runner resource)
  - Ran `make codegen` (stigmer) and `make protos` (stigmer-cloud) — all stubs regenerated
  - Re-applied SDK Go codegen fix for bidi stream (`sdk/go/internal/gen/runner.go`) — codegen tool still overwrites manual fix on each run
  - Created `send_command.go` (Go OSS handler):
    - Validates input (runner_id required, command oneof set)
    - Loads runner from store, returns NOT_FOUND if missing
    - Phase gate: STOPPED/PENDING/FAILED get specific FAILED_PRECONDITION errors
    - 10-second context timeout matching Java's hardcoded timeout
    - Builds `RunnerCommandRequest` with UUID request_id, copies command from input oneof
    - Delegates to `StreamRegistry.SendCommand` for stream routing and response correlation
  - Created `RunnerSendCommandHandler.java` (Java Cloud handler):
    - Implements `OperationHandlerV2<RunnerSendCommandInput, RunnerCommandResponse>` directly (not CRUD pipeline)
    - Wired via `@RequestRoute` to auto-generated `RunnerCommandController.Method.sendCommand`
    - FGA authorization: checks caller has `can_view` on runner via `IamPolicyGrpcRepo`
    - Local-first routing: `streamRegistry.isConnectedLocally()` → local send, else Redis coordinator
    - Same phase gate and error contract as Go handler
  - Fixed `RunnerCommandRedisCoordinator.InboundCommandListener.onMessage()`:
    - Previously swallowed `StatusRuntimeException` from `sendCommandLocally()` — requesting pod waited full 10s timeout
    - Now publishes a `RunnerCommandResponse` with `RunnerCommandError` to Redis response channel, enabling fast fail with accurate error message
  - Updated stale Javadoc on `RunnerGrpcAutoController.java` (listed `heartbeat` instead of `connect, sendCommand`)
  - Updated `BUILD.bazel` for Go runner controller (added `send_command.go`)
  - All 77 stigmer-server Bazel targets pass; stigmer-cloud compiles clean (pre-existing `SessionUpdateSandboxIdHandler` failure is unrelated)

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Proto & Codegen | **Complete** | None |
| T03 | Delete Python Heartbeat + Hacky Local FS Endpoint | **Complete** | T02 |
| T04 | OSS Server Handler (Go) | **Complete** | T02 |
| T05 | Go Client in CLI Daemon | **Complete** | T04 |
| T06 | Cloud Server Handler (Java) | **Complete** | T02 |
| T07 | API for UI to Trigger Commands | **Complete** | T04, T06 |
| T08 | Integration Testing | Pending | T05, T07 |

## Next Steps
1. **T08 is now unblocked** — all dependencies (T05, T07) are complete
2. **T08** — Integration testing (full loop: CLI → stream → server → sendCommand → runner response)
3. After T08: project complete — web UI for workspace picker is tracked in `20260422.01.runner-ux-cli-restructure` (T08/T09 of that project)

## Key Architectural Decisions

1. **Bidi stream replaces unary heartbeat**: `RunnerCommandController.connect` is the runner's only ongoing channel. Heartbeats flow runner-to-server; commands flow server-to-runner.
2. **Typed envelope with oneof**: `RunnerStreamClientMessage` and `RunnerStreamServerMessage` carry typed messages. No `google.protobuf.Any`, no command bus. Adding a command = adding to the proto oneof.
3. **First heartbeat authenticates**: The first message on a new stream MUST be a `RunnerHeartbeat`. Server validates runner_id ownership.
4. **Enriched ListDirectoryResponse**: Includes `home_directory`, `current_directory`, and `is_hidden` on `DirectoryEntry` — preserves UI feature parity with the deleted `api_fs.go` endpoint.
5. **SDK codegen gap**: `stigmer-codegen` tool doesn't handle bidi streaming RPCs. Manual fix applied to `sdk/go/internal/gen/runner.go`. Tool needs a patch (separate task).
6. **Immediate STOPPED on disconnect (both OSS and Cloud)**: No grace period in either edition. A broken stream means the runner is genuinely unreachable. The runner reconnects within seconds and the first heartbeat reactivates to READY. A grace period would create a lie (UI shows READY while runner is unreachable) for a theoretical 1-5 second benefit during rolling deploys.
7. **Replace on dual-connect**: If a runner reconnects fast, the new stream evicts the old entry. No ALREADY_EXISTS rejection.
8. **runner_id mismatch rejection**: A different runner_id on an established stream is INVALID_ARGUMENT — one stream, one runner identity.
9. **CommandStream interface for portability**: The client uses an exported `CommandStream` interface so the same `RunnerStreamClient` works with both the SDK wrapper (standalone) and raw gRPC (daemon) via factory functions.
10. **current_executions hardcoded to 0**: File-based IPC with the Python agent-runner is deferred. The heartbeat reports 0 for now.
11. **sendCommand uses dedicated `RunnerSendCommandInput`**: Separate `oneof command` rather than embedding `RunnerCommandRequest`. Keeps external API clean (no `request_id` exposure), decouples public surface from stream protocol internals.
12. **sendCommand authorization is `can_view`**: If you can see the runner in the session composer, you can send read-only commands. All current commands are read-only (ListDirectory). Write commands would warrant a finer-grained permission.
13. **Local-first routing in Cloud**: `sendCommand` handler checks `isConnectedLocally()` before falling back to Redis coordinator, avoiding unnecessary pub/sub round-trip when the API handler and stream are on the same pod.

## Known Compilation Failures (Expected)

None — all known compilation failures from proto changes have been resolved across both repos.

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

### CLI Stream Client (completed in T05)
- `client-apps/cli/internal/cli/daemon/runner_stream.go` — core stream client (CommandStream interface, RunnerStreamClient, reconnection, heartbeat)
- `client-apps/cli/internal/cli/daemon/runner_stream_commands.go` — command dispatch + ListDirectory handler
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — daemon stream lifecycle integration
- `client-apps/cli/internal/cli/runner/start.go` — standalone runner stream integration

### sendCommand API (completed in T07)
- `apis/ai/stigmer/agentic/runner/v1/command.proto` — `sendCommand` RPC with `rpc.config` auth
- `apis/ai/stigmer/agentic/runner/v1/io.proto` — `RunnerSendCommandInput` message
- `backend/services/stigmer-server/pkg/domain/runner/controller/send_command.go` — Go OSS handler
- `stigmer-cloud/backend/services/stigmer-service/.../runner/request/handler/RunnerSendCommandHandler.java` — Java Cloud handler
- `stigmer-cloud/backend/services/stigmer-service/.../runner/stream/RunnerCommandRedisCoordinator.java` — Redis error response fix

### Cloud Server (completed in T06)
- `stigmer-cloud/backend/libs/java/grpc/grpc-request/.../handler/BidiStreamHandler.java` — bidi stream handler interface (framework)
- `stigmer-cloud/backend/services/stigmer-service/.../runner/request/handler/RunnerConnectHandler.java` — bidi stream handler
- `stigmer-cloud/backend/services/stigmer-service/.../runner/service/RunnerHeartbeatService.java` — extracted heartbeat domain logic
- `stigmer-cloud/backend/services/stigmer-service/.../runner/stream/RunnerStreamRegistry.java` — in-memory stream registry
- `stigmer-cloud/backend/services/stigmer-service/.../runner/stream/RunnerStreamEntry.java` — per-runner stream state
- `stigmer-cloud/backend/services/stigmer-service/.../runner/stream/RunnerCommandRedisCoordinator.java` — Redis pub/sub cross-instance routing

## Context for Resume
- T01 plan is at `_projects/2026-04/20260422.02.runner-command-stream/tasks/T01_0_plan.md`
- This project coordinates with `20260422.01.runner-ux-cli-restructure` — T08/T09 (web UI) of that project depend on T07 of this project (sendCommand API)
- Both repos are on `feat/secrets-vault-migration` branch
- T02 changes committed: `9e3f5cb48 feat(apis/runner): add bidi command stream proto, delete unary heartbeat`
- T03 changes committed: `50eb11559 refactor: delete Python heartbeat and local FS hack (T03)`
- T04 changes committed: `5028f181b feat(backend/stigmer-server): implement bidi stream handler for runner commands (T04)`
- T05 changes committed: `617f0c969 feat(cli): implement bidi stream client for runner command channel (T05)`
- T06 changes committed: `10b59afe feat(backend): implement bidi stream handler for runner commands (T06)` (stigmer-cloud)
- The full loop is now complete in both editions: CLI opens stream → server authenticates → heartbeats flow → commands can be pushed → response routed back
- `sendCommand` API is live: UI/API callers can now send typed commands (e.g., ListDirectory) to any connected runner
- Redis pub/sub error response gap fixed: cross-instance command failures now propagate immediately instead of timing out
- SDK Go codegen still needs a patch for bidi streaming — manual fix reapplied in T07 (same as T02)

## Blockers
- None for T08 — all dependencies (T05, T07) are complete

## Quick Commands
- "Start T08" — Integration testing (full loop: CLI → stream → server → sendCommand → response)
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
