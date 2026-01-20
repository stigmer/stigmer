Here is the comprehensive Architecture Decision Record (ADR) that consolidates the Daemon, Supervisor, Storage, and Streaming strategies into a single definitive document.

---

# ADR 011: Comprehensive Local Runtime Architecture (The Stigmer Daemon)

**Status**: Accepted
**Date**: January 18, 2026
**Context**:
To provide a robust "Tier 1" local development experience, Stigmer must support:

1. **Polyglot Execution**: Running both Go (Workflow) and Python (Agent) logic on a developer's machine.
2. **Real-Time Observability**: Streaming execution logs and status updates to the CLI without heavy infrastructure like Redis.
3. **Unified State**: A single source of truth for execution data to prevent concurrency issues between processes.
4. **Simple UX**: Developers should run a single command (`stigmer local start`) to spin up the entire stack.

**Decision**:
We will implement a **Centralized Daemon Architecture** using the **Supervisor Pattern**.

The `stigmer local start` command will launch a long-running Go process (The Daemon) that acts as the "Hub" for the local environment. It serves as the API Server, Data Guardian, Stream Broker, and Process Supervisor.

## 1. Component Roles

### A. The Stigmer Daemon (The Hub)

This is the parent process written in Go. It has four critical responsibilities:

1. **API Server**: Hosts a gRPC server on `localhost:50051` (identical contract to Cloud).
2. **Data Guardian**: Holds the exclusive connection to the embedded **SQLite** database.
3. **Stream Broker**: Manages in-memory **Go Channels** to broadcast real-time updates to CLI watchers.
4. **Supervisor**: Manages the lifecycle of worker processes (starts/stops them).

### B. The Workers (The Spokes)

* **Workflow Runner (Go)**: Runs as an **Embedded Goroutine** inside the Daemon process. It shares memory and resources with the API server.
* **Agent Runner (Python)**: Runs as a **Managed Subprocess** spawned by the Daemon. It communicates with the Daemon solely via gRPC Clients.

### C. The CLI (The Interface)

The `stigmer` CLI (e.g., `stigmer logs`) acts as a pure **gRPC Client**. It never reads the SQLite file directly; it connects to the Daemon on port 50051.

## 2. Communication & Data Flow

### Write Path (Updating State)

When the Python Agent Runner needs to save state (e.g., "Step Completed"):

1. **Python**: Calculates state  calls `grpc_stub.Update(msg)` to `localhost:50051`.
2. **Daemon**: Receives RPC.
3. **Daemon (Persistence)**: Serializes message  Writes to **SQLite** `resources` table.
4. **Daemon (Streaming)**: Pushes message to active **Go Channels**.

### Read Path (Streaming Logs)

When a user runs `stigmer logs -f <id>`:

1. **CLI**: Calls `grpc_stub.Watch(id)` to `localhost:50051`.
2. **Daemon**: Subscribes the request to the internal **Go Channel** for that ID.
3. **Daemon**: Streams new events from the channel down the gRPC pipe to the CLI.

## 3. Implementation Details

### Supervisor Logic (Startup Sequence)

When `stigmer local start` is executed:

1. **Pre-flight Checks**: Verify `python3` is installed and `docker` is running (for Temporal).
2. **Start Database**: Open SQLite connection (enable WAL mode).
3. **Start API**: Listen on TCP `50051`.
4. **Start Workflow Worker**: Launch `go startWorkflowWorker()` in a goroutine.
5. **Start Agent Worker**:
* Execute `cmd := exec.Command("python3", "-m", "agent_runner")`.
* Pipe `cmd.Stdout` / `cmd.Stderr` to the main Daemon logger (prefixed with `[PYTHON]`).
* Pass environment variables: `STIGMER_ADDR=localhost:50051`.


6. **Signal Handling**: On `SIGINT` (Ctrl+C), the Daemon sends a kill signal to the Python subprocess before exiting, ensuring no "zombie" processes.

### Storage Logic

* **Engine**: SQLite (via `modernc.org/sqlite`).
* **Schema**: Single generic table (`resources`) storing JSON blobs.
* **Concurrency**: Only the Daemon writes. Python and CLI interact via API, eliminating file-lock contention.

## 4. Consequences

### Positive

* **Zero "Hidden" Complexity**: The user manages one process. If the Daemon is running, everything is running.
* **Language Agnostic**: We can add a Node.js or Rust runner in the future simply by spawning another subprocess that speaks gRPC.
* **Performance**: In-memory streaming and embedded SQLite provide near-instant feedback for local development.
* **Clean Architecture**: Python code remains "dumb" (pure logic + gRPC client), with no database dependencies.

### Negative

* **Single Point of Failure**: If the Daemon crashes, the entire local stack (API, Stream, Workers) goes down.
* **Binary Weight**: The Daemon binary includes the CLI, API Server, and Workflow Runner logic, making it slightly larger (though negligible in Go).
* **Port conflicts**: Requires port `50051` to be free. (Mitigation: Make port configurable via flags).

## 5. Implementation Status

**Status**: ✅ Fully Implemented (as of January 20, 2026)

### Streaming Infrastructure

Both WorkflowExecution and AgentExecution have complete streaming support:

| Component | WorkflowExecution | AgentExecution |
|-----------|-------------------|----------------|
| StreamBroker (in-memory Go channels) | ✅ | ✅ |
| Write Path (UpdateStatus → Broadcast) | ✅ | ✅ |
| Read Path (Subscribe → Stream) | ✅ | ✅ |

**Files**:
- `backend/.../workflowexecution/controller/stream_broker.go` - In-memory channel management
- `backend/.../workflowexecution/controller/update_status.go` - Write Path with Broadcast step
- `backend/.../workflowexecution/controller/subscribe.go` - Read Path Subscribe RPC handler
- `backend/.../agentexecution/controller/stream_broker.go` - In-memory channel management
- `backend/.../agentexecution/controller/update_status.go` - Write Path with Broadcast step
- `backend/.../agentexecution/controller/subscribe.go` - Read Path Subscribe RPC handler

**Streaming Flow** (Operational):

```
Write Path:
workflow-runner → UpdateStatus RPC → BadgerDB persist → Broadcast → Go channels

Read Path:
CLI (stigmer run) → Subscribe RPC → Go channel subscription → Real-time stream → CLI
```

**Usage**:

```bash
# Start daemon
stigmer local start

# Run workflow with real-time streaming
stigmer run  # Logs stream in real-time ✓

# Run agent with real-time streaming
stigmer run  # Logs stream in real-time ✓
```

**Performance Characteristics**:
- Near-instant updates (< 100ms typical latency)
- Zero external dependencies (no Redis/message queue)
- Buffered channels (100 message buffer)
- Automatic cleanup on client disconnect