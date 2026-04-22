# Next Task: 20260422.02.runner-command-stream

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.02.runner-command-stream

**Description**: Implement a bidirectional gRPC stream between the Runner supervisor (Go) and Stigmer Server, replacing the unary heartbeat RPC and enabling server-initiated commands like filesystem browsing for workspace selection in session creation.
**Goal**: Establish a persistent bidi gRPC stream from the Runner to the server that carries heartbeats (runner to server) and server-initiated commands (server to runner, e.g., ListDirectory). Phase 1 covers agent runner only; workflow runner integration is deferred.
**Tech Stack**: Go (runner supervisor/CLI daemon), Python (agent-runner heartbeat migration), Protobuf (stream proto definitions), Java (stigmer-service stream handler)
**Components**: apis/ai/stigmer/agentic/runner/v1/ (proto); client-apps/cli/internal/cli/daemon/ (Go supervisor); backend/services/agent-runner/worker/heartbeat.py (Python heartbeat removal); backend/services/stigmer-server/ (Go stream handler); stigmer-cloud/backend/services/stigmer-service/ (Java stream handler)

## Current State
- **Status**: T02 complete, ready for T03
- **Last Session**: 2026-04-22 — T02 implemented (proto & codegen for bidi stream)
- **Active Task**: T03 — Delete Python Heartbeat + Hacky Local FS Endpoint

## Session Progress (2026-04-22, Session 1)
- Reviewed T01 plan and confirmed key decisions
- Implemented T02: Proto & Codegen
  - Deleted `heartbeat` RPC and `RunnerHeartbeatInput` from runner proto
  - Added `connect` bidi stream RPC to `RunnerCommandController`
  - Added 9 new message types: `RunnerStreamClientMessage`, `RunnerStreamServerMessage`, `RunnerHeartbeat`, `RunnerCommandRequest`, `RunnerCommandResponse`, `ListDirectoryRequest`, `ListDirectoryResponse`, `DirectoryEntry`, `RunnerCommandError`
  - Enriched `ListDirectoryResponse` with `home_directory`, `current_directory` and `DirectoryEntry.is_hidden` for UI feature parity
  - Ran codegen in stigmer (`make codegen`) and stigmer-cloud (`make protos`)
  - Fixed SDK Go codegen bug: `stigmer-codegen` tool doesn't handle bidi streams — manually fixed `sdk/go/internal/gen/runner.go` with correct Send/Recv/CloseSend wrapper

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Proto & Codegen | **Complete** | None |
| T03 | Delete Python Heartbeat + Hacky Local FS Endpoint | Pending | T02 |
| T04 | OSS Server Handler (Go) | Pending | T02 |
| T05 | Go Client in CLI Daemon | Pending | T04 |
| T06 | Cloud Server Handler (Java) | Pending | T02 |
| T07 | API for UI to Trigger Commands | Pending | T04, T06 |
| T08 | Integration Testing | Pending | T05, T07 |

## Next Steps
1. **Start T03** — Delete Python heartbeat code and hacky local FS endpoint
2. Python heartbeat files to delete: `heartbeat.py`, `runner_client.py`, HeartbeatEmitter in `worker.py`, `runner_id` config
3. Local FS hack files to delete: `api_fs.go`, `handleFSList` in `handler.go`, `useFolderListing.ts`, `FolderBrowser.tsx`, `enableFolderBrowser` wiring in `WorkspaceEditor.tsx`, `SessionLauncher.tsx`, `SessionPage.tsx`, `next.config.ts`
4. T03 and T04 can proceed in parallel (T03 is cleanup, T04 is new implementation)

## Key Architectural Decisions

1. **Bidi stream replaces unary heartbeat**: `RunnerCommandController.connect` is the runner's only ongoing channel. Heartbeats flow runner-to-server; commands flow server-to-runner.
2. **Typed envelope with oneof**: `RunnerStreamClientMessage` and `RunnerStreamServerMessage` carry typed messages. No `google.protobuf.Any`, no command bus. Adding a command = adding to the proto oneof.
3. **First heartbeat authenticates**: The first message on a new stream MUST be a `RunnerHeartbeat`. Server validates runner_id ownership.
4. **Enriched ListDirectoryResponse**: Includes `home_directory`, `current_directory`, and `is_hidden` on `DirectoryEntry` — preserves UI feature parity with the existing `api_fs.go` endpoint.
5. **SDK codegen gap**: `stigmer-codegen` tool doesn't handle bidi streaming RPCs. Manual fix applied to `sdk/go/internal/gen/runner.go`. Tool needs a patch (separate task).

## Known Compilation Failures (Expected)

These will be resolved as subsequent tasks are completed:
- `backend/services/stigmer-server/pkg/domain/runner/controller/heartbeat.go` — references deleted `RunnerHeartbeatInput`, implements deleted `Heartbeat()` (resolved in T04)
- `client-apps/cli/internal/cli/runner/start.go` — calls `client.Runner.Heartbeat()` (resolved in T05)
- Python `heartbeat.py` — calls deleted heartbeat RPC (resolved in T03)
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

### Python (T03 target — deletion)
- `backend/services/agent-runner/worker/heartbeat.py`
- `backend/services/agent-runner/grpc_client/runner_client.py`

### Local FS Hack (T03 target — deletion)
- `client-apps/cli/embedded/webconsole/api_fs.go`
- `sdk/react/src/workspace/useFolderListing.ts`
- `sdk/react/src/workspace/FolderBrowser.tsx`

## Context for Resume
- T01 plan is at `_projects/2026-04/20260422.02.runner-command-stream/tasks/T01_0_plan.md`
- This project coordinates with `20260422.01.runner-ux-cli-restructure` — T08/T09 (web UI) of that project depend on T07 of this project (sendCommand API)
- Both repos are on `feat/secrets-vault-migration` branch
- T02 changes are in both stigmer and stigmer-cloud repos (uncommitted at session end, pending commit)

## Blockers
- None for T03 or T04

## Quick Commands
- "Start T03" — Delete Python heartbeat + local FS hack
- "Start T04" — Implement OSS server connect handler
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
