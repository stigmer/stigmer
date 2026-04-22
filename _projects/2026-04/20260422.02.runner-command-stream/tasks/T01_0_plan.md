# Task T01: Runner Command Stream — Design & Implementation Plan

**Created**: 2026-04-22
**Status**: PENDING REVIEW
**Type**: Feature Development

> **This plan requires your review before execution.**

## Context

Today the runner's only ongoing communication channel with the server is a **unary gRPC heartbeat** (`RunnerCommandController.heartbeat`) called every 30s by the Python agent-runner. All communication is runner-initiated — the server has no way to push commands to the runner.

With runners becoming a first-class user-managed resource, we need the server to reach the runner for interactive operations — specifically, **browsing the runner's filesystem** so users can select a workspace when creating a session bound to a remote runner.

Rather than building a full Konnectivity-style reverse tunnel (massive overkill for the current use case), we implement a **bidirectional gRPC stream** that the runner initiates. The runner pushes heartbeats; the server pushes commands. Both directions use the same open connection.

### Scope Boundary

**This project**: Agent runner only. The Go CLI daemon opens the bidi stream, sends heartbeats, and handles server commands. The Python agent-runner's heartbeat code is **deleted entirely** (not deployed, not in use by anyone).

**Future**: Workflow runner integration. The supervisor adds workflow worker health tracking to the heartbeat. The workflow runner's own heartbeat (if any) follows the same pattern.

## Architecture

### Stream Topology

```
Runner Process (Go)                    Stigmer Server
─────────────────                    ──────────────────
                                      
CLI daemon / supervisor  ──bidi──►  RunnerCommandController.connect()
  │                                    │
  ├─► sends: heartbeat (every 30s)     ├─► receives heartbeat, updates Runner
  ├─► sends: command response          │   resource status fields
  │                                    │
  ├─◄ receives: command request  ◄─────├─◄ pushes command when UI triggers
  │   (e.g., ListDirectory)            │   (e.g., session composer workspace picker)
  │                                    │
  └─► handles command locally,         └── brokers between UI/API caller
      sends response on stream              and the stream
```

### Message Design

The stream carries a **typed envelope** with `oneof` for each direction. This keeps full gRPC type safety (no `google.protobuf.Any`), makes adding new command types a proto change, and avoids the "command bus" anti-pattern.

**Runner → Server** (client messages):

```protobuf
message RunnerStreamClientMessage {
  oneof message {
    RunnerHeartbeat heartbeat = 1;
    RunnerCommandResponse command_response = 2;
  }
}
```

**Server → Runner** (server messages):

```protobuf
message RunnerStreamServerMessage {
  oneof message {
    RunnerCommandRequest command_request = 1;
  }
}
```

**Heartbeat** (replaces `RunnerHeartbeatInput`, which is deleted):

```protobuf
message RunnerHeartbeat {
  string runner_id = 1;
  RunnerPhase phase = 2;
  int32 current_executions = 3;
  RunnerConnectionInfo connection_info = 4;
}
```

**Command request/response** (extensible via `oneof`):

```protobuf
message RunnerCommandRequest {
  string request_id = 1;  // correlate request to response
  oneof command {
    ListDirectoryRequest list_directory = 2;
    // Future: GetFileContent, etc.
  }
}

message RunnerCommandResponse {
  string request_id = 1;  // matches RunnerCommandRequest.request_id
  oneof result {
    ListDirectoryResponse list_directory = 2;
    RunnerCommandError error = 3;
  }
}

message ListDirectoryRequest {
  string path = 1;  // absolute or ~-relative path on the runner machine
}

message ListDirectoryResponse {
  string resolved_path = 1;  // absolute path after ~ expansion
  repeated DirectoryEntry entries = 2;
}

message DirectoryEntry {
  string name = 1;
  bool is_directory = 2;
}

message RunnerCommandError {
  string message = 1;
}
```

### RPC Definition

The `connect` RPC **replaces** the unary `heartbeat` RPC on `RunnerCommandController`. The unary `heartbeat` RPC and `RunnerHeartbeatInput` message are deleted from the proto.

```protobuf
rpc connect(stream RunnerStreamClientMessage) returns (stream RunnerStreamServerMessage) {
  option (ai.stigmer.commons.rpc.is_skip_authorization) = true;
}
```

The stream is the runner's **only** ongoing communication channel with the server.

### Stream Lifecycle

1. Runner process starts, calls `apply` to register/reactivate the runner resource.
2. Runner opens the `connect` bidi stream.
3. First message MUST be a heartbeat (authenticates the stream via runner_id lookup + ownership check).
4. Runner sends heartbeats every 30s on the stream.
5. Server pushes command requests when the UI triggers an operation.
6. Runner handles commands locally (e.g., reads directory) and sends responses on the stream.
7. On graceful shutdown: runner sends a final heartbeat with phase=STOPPED, then closes the stream.
8. On unexpected disconnect: server detects stream break, starts the heartbeat timeout (90s). If no reconnect, runner transitions to STOPPED.
9. On reconnect: runner opens a new `connect` stream, sends a heartbeat → back to READY.

### Reconnection During Server Deployment

When the server pod is killed during a rolling deployment:

- Old pod drains, existing bidi streams get CANCELLED.
- Runner detects stream break immediately.
- Runner reconnects with exponential backoff: 1s, 2s, 4s, 8s, up to 60s max.
- New pod starts (typically 5-15s), runner's reconnect succeeds.
- First heartbeat re-authenticates the stream → runner back to READY.
- Total disruption: 5-20 seconds. No data loss, no manual intervention.

In Cloud (multi-replica), the heartbeat state is in MongoDB — the new pod picks up where the old one left off. The 90s heartbeat timeout provides ample buffer.

In OSS (single instance), the runner keeps reconnecting until the server comes back. Temporal (separate process) continues processing work independently.

### Security Model

The command stream does NOT execute arbitrary code on the user's machine. The command set is **fixed at compile time** by the proto's `oneof command`. Today that's `ListDirectoryRequest` (returns filenames — read-only, no file contents, no shell execution). Adding a new command type requires a proto change, a code release, and the runner to upgrade.

This is significantly more conservative than comparable systems:

- **GitHub Actions self-hosted runners**: execute arbitrary workflow YAML, shell scripts, docker containers
- **VS Code Remote Tunnels / Cursor**: full filesystem access, terminal, arbitrary code execution
- **GitLab Runner**: arbitrary CI pipeline execution

Stigmer's runner responds only to typed, read-only, scoped commands. The user explicitly opted in by starting the runner.

**Observability requirement**: The runner MUST log every command it receives to stdout so the user can see what the server is requesting. Example: `[INFO] Server requested directory listing: /Users/alice/projects`

### Server-Side Stream Management

The server tracks active streams in memory:

```
RunnerStreamRegistry (in-memory, per server instance)
─────────────────────
runner_id → {
  stream: ServerStreamSender,
  connected_at: Timestamp,
  last_heartbeat_at: Timestamp,
}

When UI calls "list directory on runner X":
  1. Look up runner X in the stream registry
  2. If connected: push ListDirectoryRequest, await response (with timeout)
  3. If not connected: return UNAVAILABLE ("runner is not connected")
```

**OSS**: One server instance, no coordination needed.

**Cloud (multi-replica)**: The API handler may not be on the instance holding the stream. Coordination via **Redis pub/sub** (Cloud already has Redis):
- API handler publishes the command request to a Redis channel keyed by runner_id
- The instance with the stream picks it up, pushes to the runner, publishes the response
- API handler receives the response and returns to the caller

### Future: Supervisor Watching Multiple Workers

In a future phase when the workflow runner is integrated, the supervisor manages both workers. The heartbeat carries per-worker health detail:

```protobuf
message RunnerHeartbeat {
  string runner_id = 1;
  RunnerPhase phase = 2;
  int32 current_executions = 3;
  RunnerConnectionInfo connection_info = 4;
  repeated WorkerHealth workers = 5;  // per-worker health (future)
}

message WorkerHealth {
  string worker_type = 1;  // "agent" or "workflow"
  bool healthy = 2;
}
```

The runner's **phase** is an aggregate signal: READY means "this runner is reachable and accepting work." If the workflow worker is down but the agent worker is up, the runner is still READY — it can accept agent executions. Temporal handles the rest: workflow tasks sit in the queue until the workflow worker recovers.

This detail is deferred to the future workflow runner integration project. For now, the supervisor manages only the agent worker.

## Task Breakdown

### Phase 1: Proto & Codegen (T02)

**Scope**: Define the stream messages and RPC. Delete the unary heartbeat RPC and `RunnerHeartbeatInput`.

Files touched:
- `apis/ai/stigmer/agentic/runner/v1/command.proto` — delete `heartbeat` RPC, add `connect` RPC
- `apis/ai/stigmer/agentic/runner/v1/io.proto` — delete `RunnerHeartbeatInput`, add stream messages (`RunnerStreamClientMessage`, `RunnerStreamServerMessage`, `RunnerHeartbeat`, `RunnerCommandRequest`, `RunnerCommandResponse`, `ListDirectoryRequest`, `ListDirectoryResponse`, `DirectoryEntry`, `RunnerCommandError`)
- Update proto comments on `RunnerCommandController` (the `heartbeat` references)
- Run `make codegen` in stigmer, `make protos` in stigmer-cloud

Estimated effort: 1 day

### Phase 2: Delete Python Heartbeat + Hacky Local FS Endpoint (T03)

**Scope**: Remove the Python heartbeat code entirely. Also remove the ad-hoc `GET /api/fs/list` HTTP endpoint on the CLI's embedded web console and the React components that consume it — this local-only hack is replaced by the proper `ListDirectory` command over the bidi stream.

**Python heartbeat — delete:**
- `backend/services/agent-runner/worker/heartbeat.py`
- `backend/services/agent-runner/grpc_client/runner_client.py`
- `backend/services/agent-runner/worker/worker.py` — remove `HeartbeatEmitter` creation and lifecycle
- `backend/services/agent-runner/worker/config.py` — remove `runner_id` config if no longer needed by the Python side
- Any imports referencing the deleted modules

**Local filesystem HTTP hack — delete:**
- `client-apps/cli/embedded/webconsole/api_fs.go` — the `handleFSList` handler that calls `os.ReadDir`
- `client-apps/cli/embedded/webconsole/handler.go` — remove `mux.HandleFunc("/api/fs/list", handleFSList)` registration
- `sdk/react/src/workspace/useFolderListing.ts` — React hook that fetches from `/api/fs/list`
- `sdk/react/src/workspace/FolderBrowser.tsx` — folder browser component
- `sdk/react/src/workspace/WorkspaceEditor.tsx` — remove `enableFolderBrowser` toggle / refactor to use the new gRPC-backed approach (Phase 6)
- `client-apps/web/src/components/session/SessionLauncher.tsx` — remove `enableFolderBrowser={deploymentMode === "local"}` prop
- `client-apps/web/src/app/sessions/[id]/SessionPage.tsx` — remove `enableFolderBrowser` prop
- `client-apps/web/next.config.ts` — remove `/api/fs/:path*` dev rewrite to `localhost:8234`
- `docs/sdk/react/workspace.mdx` — remove `GET /api/fs/list` documentation

This cleanup ensures there is exactly ONE path for filesystem browsing: the `ListDirectory` command over the runner's bidi stream. No local-only shortcuts, works identically for local and remote runners.

Estimated effort: 1 day

### Phase 3: OSS Server Handler (T04)

**Scope**: Implement the `connect` stream handler in stigmer-server (Go). Delete the unary heartbeat handler.

Files deleted/modified:
- `backend/services/stigmer-server/pkg/domain/runner/controller/heartbeat.go` — delete (or refactor: extract the heartbeat processing logic into a shared function, delete the unary RPC handler)

Files created:
- `backend/services/stigmer-server/pkg/domain/runner/controller/connect.go` — bidi stream handler
- `backend/services/stigmer-server/pkg/domain/runner/stream_registry.go` — in-memory stream registry

Key behaviors:
- First client message must be a heartbeat (validates runner identity)
- Heartbeat messages update Runner status fields (same logic as the old unary handler)
- CommandRequest messages are pushed via `registry.SendCommand(runnerId, request)` — blocks until response or timeout
- Stream disconnect transitions runner to STOPPED (immediate, since stream IS the heartbeat channel)
- Log every command sent to a runner (server-side observability)

Estimated effort: 3-4 days

### Phase 4: Go Client in CLI Daemon (T05)

**Scope**: Implement the stream client in the Go CLI daemon.

Files created:
- `client-apps/cli/internal/cli/daemon/runner_stream.go` — stream client with heartbeat, command handling, reconnection

Files modified:
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — integrate stream lifecycle into daemon startup/shutdown

Key behaviors:
- Opens the bidi stream to the server after `apply` succeeds
- Sends heartbeat every 30s (for Phase 1, `current_executions` can be 0 or tracked via file-based IPC with agent-runner)
- Receives commands: dispatches ListDirectory locally, sends response on stream
- Logs every received command to stdout for user visibility
- Reconnects with exponential backoff (1s, 2s, 4s, 8s, max 60s) on disconnect
- Sends STOPPED heartbeat on graceful shutdown

Estimated effort: 3-4 days

### Phase 5: Cloud Server Handler (T06)

**Scope**: Implement the `connect` stream handler in stigmer-service (Java). Delete the unary heartbeat handler.

Files touched:
- `stigmer-cloud/backend/services/stigmer-service/` — new handler class for `connect`, delete `RunnerHeartbeatHandler`
- Stream registry with Redis pub/sub for cross-instance coordination
- FGA authorization on first heartbeat

Key behaviors:
- Same contract as the Go handler (identical behavior)
- Redis pub/sub for routing command requests to the instance holding the runner's stream
- Stream disconnect handling with same semantics as OSS

Estimated effort: 3-4 days

### Phase 6: API for UI to Trigger Commands (T07)

**Scope**: Expose an API for the web UI to request a directory listing from a runner.

New RPC on `RunnerCommandController`:
```protobuf
rpc sendCommand(RunnerSendCommandInput) returns (RunnerCommandResponse);
```

The server receives the request, looks up the runner's stream in the registry, pushes the command, and returns the response synchronously (with a timeout, e.g., 10s).

Files touched:
- Proto: new RPC + `RunnerSendCommandInput` message
- OSS server: handler delegates to stream registry
- Cloud server: handler publishes to Redis, waits for response

Estimated effort: 2-3 days

### Phase 7: Integration Testing (T08)

**Scope**: End-to-end testing.

- Stream + heartbeat works in local daemon mode
- ListDirectory works from a test client
- Stream reconnection on server restart
- STOPPED transition on stream disconnect
- Cloud: Redis pub/sub routing across instances
- Runner logs every received command

Estimated effort: 2 days

## Phased Delivery Summary

| Phase | Task | Effort | Deliverable |
|-------|------|--------|-------------|
| 1 | Proto & codegen | 1 day | Stream RPC defined, unary heartbeat deleted |
| 2 | Delete Python heartbeat + local FS hack | 1 day | Clean removal of heartbeat.py, runner_client.py, api_fs.go, FolderBrowser, useFolderListing |
| 3 | OSS server handler | 3-4 days | Go server accepts bidi stream, processes heartbeats + commands |
| 4 | Go client in CLI daemon | 3-4 days | Daemon opens stream, sends heartbeats, handles commands |
| 5 | Cloud server handler | 3-4 days | Java service mirrors Go handler with Redis coordination |
| 6 | UI command API | 2-3 days | API endpoint for UI to trigger commands on a runner |
| 7 | Integration testing | 2 days | End-to-end verified |

**Total**: ~16-20 days (3-4 weeks)

Each phase is independently shippable. Phases 1-4 deliver a working stream in OSS. Phase 5 extends to Cloud. Phase 6 delivers the user-facing API. Phase 7 validates everything.

## Key Design Decisions (pending your input)

1. **Execution count in Go supervisor heartbeat**: The Go daemon doesn't currently track how many executions the Python agent-runner is processing. Options:
   - **File-based IPC**: agent-runner writes execution count to a file (e.g., `~/.stigmer/runners/{id}/executions.count`); supervisor reads it on each heartbeat tick. Simplest, reliable, no new dependencies.
   - **Defer**: send `current_executions = 0` initially; add IPC in a later phase.
   - Recommendation: file-based IPC.

2. **Cloud multi-instance coordination**: Redis pub/sub (recommended, already available), sticky routing, or broadcast.

## Risks

- **Stream lifecycle complexity**: Bidi streams require careful handling of disconnects, reconnects, concurrent reads/writes, and graceful shutdown. The Go gRPC library handles most of this, but the reconnection logic and "first message must be heartbeat" protocol need thorough testing.
- **Coordination with `runner-ux-cli-restructure`**: Both projects modify the CLI daemon. Phase 4 here touches `daemon_process.go`. Recommendation: sequence Phase 4 after the daemon restructure lands, or coordinate closely.

## What This Does NOT Include

- Workflow runner integration (deferred to future project)
- Runner supervisor as a separate binary (CLI daemon serves as supervisor)
- Web UI implementation for the workspace picker (Phase 6 covers the API; UI is in `runner-ux-cli-restructure`)

## Review Process

**What happens next**:
1. **You review this plan** — consider the architecture, phasing, and open decisions
2. **Provide feedback** — especially on the two design decisions above
3. **I'll revise** — create T01_2_revised_plan.md if needed
4. **You approve** — execution begins with T02 (proto definitions)
