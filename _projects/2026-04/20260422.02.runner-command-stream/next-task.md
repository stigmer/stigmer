# Next Task: 20260422.02.runner-command-stream

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.02.runner-command-stream

**Description**: Implement a bidirectional gRPC stream between the Runner supervisor (Go) and Stigmer Server, replacing the unary heartbeat RPC and enabling server-initiated commands like filesystem browsing for workspace selection in session creation.
**Goal**: Establish a persistent bidi gRPC stream from the Runner to the server that carries heartbeats (runner to server) and server-initiated commands (server to runner, e.g., ListDirectory). Phase 1 covers agent runner only; workflow runner integration is deferred.
**Tech Stack**: Go (runner supervisor/CLI daemon), Protobuf (stream proto definitions), Java (stigmer-service stream handler)
**Components**: apis/ai/stigmer/agentic/runner/v1/ (proto); client-apps/cli/internal/cli/daemon/ (Go supervisor); backend/services/stigmer-server/ (Go stream handler); stigmer-cloud/backend/services/stigmer-service/ (Java stream handler)

## Current State
- **Status**: T03 complete, ready for T04
- **Last Session**: 2026-04-22 — T03 implemented (deleted Python heartbeat + local FS hack)
- **Active Task**: T04 — OSS Server Handler (Go)

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

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Proto & Codegen | **Complete** | None |
| T03 | Delete Python Heartbeat + Hacky Local FS Endpoint | **Complete** | T02 |
| T04 | OSS Server Handler (Go) | Pending | T02 |
| T05 | Go Client in CLI Daemon | Pending | T04 |
| T06 | Cloud Server Handler (Java) | Pending | T02 |
| T07 | API for UI to Trigger Commands | Pending | T04, T06 |
| T08 | Integration Testing | Pending | T05, T07 |

## Next Steps
1. **Start T04** — Implement `connect` bidi stream handler in stigmer-server (Go)
2. Create `backend/services/stigmer-server/pkg/domain/runner/controller/connect.go` — bidi stream handler
3. Create `backend/services/stigmer-server/pkg/domain/runner/stream_registry.go` — in-memory stream registry
4. Refactor/delete `heartbeat.go` — extract heartbeat processing logic, delete unary handler
5. T04 and T06 can proceed in parallel (Go server and Java server are independent)

## Key Architectural Decisions

1. **Bidi stream replaces unary heartbeat**: `RunnerCommandController.connect` is the runner's only ongoing channel. Heartbeats flow runner-to-server; commands flow server-to-runner.
2. **Typed envelope with oneof**: `RunnerStreamClientMessage` and `RunnerStreamServerMessage` carry typed messages. No `google.protobuf.Any`, no command bus. Adding a command = adding to the proto oneof.
3. **First heartbeat authenticates**: The first message on a new stream MUST be a `RunnerHeartbeat`. Server validates runner_id ownership.
4. **Enriched ListDirectoryResponse**: Includes `home_directory`, `current_directory`, and `is_hidden` on `DirectoryEntry` — preserves UI feature parity with the deleted `api_fs.go` endpoint.
5. **SDK codegen gap**: `stigmer-codegen` tool doesn't handle bidi streaming RPCs. Manual fix applied to `sdk/go/internal/gen/runner.go`. Tool needs a patch (separate task).

## Known Compilation Failures (Expected)

These will be resolved as subsequent tasks are completed:
- `backend/services/stigmer-server/pkg/domain/runner/controller/heartbeat.go` — references deleted `RunnerHeartbeatInput`, implements deleted `Heartbeat()` (resolved in T04)
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

### Server (T04 target)
- `backend/services/stigmer-server/pkg/domain/runner/controller/heartbeat.go` — to be refactored into connect handler
- `backend/services/stigmer-server/pkg/domain/runner/controller/connect.go` — new bidi stream handler
- `backend/services/stigmer-server/pkg/domain/runner/stream_registry.go` — new in-memory stream registry

### CLI Daemon (T05 target)
- `client-apps/cli/internal/cli/daemon/runner_stream.go` — new stream client
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — stream lifecycle integration

## Context for Resume
- T01 plan is at `_projects/2026-04/20260422.02.runner-command-stream/tasks/T01_0_plan.md`
- This project coordinates with `20260422.01.runner-ux-cli-restructure` — T08/T09 (web UI) of that project depend on T07 of this project (sendCommand API)
- Both repos are on `feat/secrets-vault-migration` branch
- T02 changes are committed: `9e3f5cb48 feat(apis/runner): add bidi command stream proto, delete unary heartbeat`
- T03 changes are committed in this session
- Python heartbeat code is fully deleted — the Go daemon (T05) will own heartbeat over the bidi stream
- Local FS hack fully deleted — `ListDirectory` over bidi stream (T04-T07) replaces it

## Blockers
- None for T04 or T06

## Quick Commands
- "Start T04" — Implement OSS server connect handler
- "Start T06" — Implement Cloud server connect handler (Java)
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
