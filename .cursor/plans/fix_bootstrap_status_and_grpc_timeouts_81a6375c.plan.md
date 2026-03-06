---
name: Fix bootstrap status and gRPC timeouts
overview: "Fix two issues: (1) `stigmer server status` shows \"Bootstrap: Not Started\" because the new seedpack-based bootstrap writes to a flag file but status reads from an orphaned SQLite table, and (2) intermittent gRPC DEADLINE_EXCEEDED errors caused by missing keepalive on Python channels, per-activity channel churn, and no readiness gate in the daemon."
todos:
  - id: fix-bootstrap-status
    content: Rewrite GetBootstrapStatus() to use seedpack flag file instead of dead SQLite table; update server_status.go to pass dataDir
    status: completed
  - id: channel-factory
    content: Create shared channel factory (channel.py) with keepalive options and ChannelProvider for channel reuse across clients
    status: completed
  - id: update-grpc-clients
    content: Update all 8 Python gRPC client classes to accept an optional shared channel and use the channel factory for keepalive
    status: completed
  - id: update-activity-callers
    content: Update execute_graphton.py and generate_session_subject.py to use ChannelProvider for shared channel across all clients
    status: completed
  - id: daemon-readiness-gate
    content: Add gRPC readiness check in daemon_process.go between stigmer-server start and workflow-runner/agent-runner start
    status: completed
isProject: false
---

# Fix Bootstrap Status Reporting and Intermittent gRPC DEADLINE_EXCEEDED

## Root Cause Analysis

### Issue 1: Bootstrap shows "Not Started" after successful apply

The bootstrap mechanism was refactored (per `_changelog/2026-02-28-...`):

- **Before:** Server-side `bootstrap.Run()` wrote `bootstrap_status=completed` to the `bootstrap_state` SQLite table.
- **After:** CLI-based `EnsureSeedpackBootstrapped()` runs `stigmer apply` and writes a content-hash to a flat file at `$dataDir/.seedpack-bootstrapped`.

The status command in `[client-apps/cli/internal/cli/bootstrap/status.go](client-apps/cli/internal/cli/bootstrap/status.go)` still reads from `bootstrap_state` in SQLite, which is never populated. `SetBootstrapState` in `[backend/libs/go/store/sqlite/store.go](backend/libs/go/store/sqlite/store.go)` exists but is only called from tests.

**Fix:** Align `GetBootstrapStatus()` with the new seedpack flag file mechanism. The SQLite `bootstrap_state` table is dead code for bootstrap tracking.

### Issue 2: Intermittent gRPC DEADLINE_EXCEEDED

The error trace from `[_cursor/error.md](_cursor/error.md)` shows failures in `agent_client.get()` and `agent_execution_client.update_status()` -- both from the Python agent-runner calling stigmer-server on localhost:7234. There are **four compounding root causes**:

**A. No gRPC keepalive on Python channels.**
All 8 client classes in `[backend/services/agent-runner/grpc_client/](backend/services/agent-runner/grpc_client/)` create `grpc.aio.insecure_channel(endpoint)` with zero channel options. The Go server has `KeepaliveEnforcementPolicy(MinTime: 5s)` and `KeepaliveParams(Time: 15s, Timeout: 5s)`, but Python channels have no matching keepalive. On idle channels, the server may GOAWAY the connection without the client realizing, causing the next RPC to fail.

**B. New gRPC channel per activity invocation.**
Every `execute_graphton` activity creates 4 fresh client instances (line ~1105-1109 of `execute_graphton.py`), each opening a new `grpc.aio.insecure_channel`. Under concurrent activity load, this means potentially dozens of TCP connections to the same localhost:7234. Connection setup overhead adds latency, and channel fragmentation wastes server resources.

**C. 10-second per-call timeout is tight under load.**
`_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0` is applied per-call. When the server is busy (e.g., during seedpack bootstrap which fires `stigmer apply` creating many resources), a single `agent.get()` can exceed 10s due to server queueing. The retry executor retries 3 times with 1s/2s backoff, but each retry also has a 10s deadline -- if the server is slow, all 3 attempts fail.

**D. No readiness gate in daemon process.**
In `[daemon_process.go](client-apps/cli/internal/cli/daemon/daemon_process.go)` (line ~106), the daemon starts stigmer-server, workflow-runner, and agent-runner sequentially with no gRPC readiness check between them -- just a `time.Sleep(2 * time.Second)` after all start. The CLI does call `WaitForReady` before seedpack bootstrap, but the daemon's own children do not wait. Workflow-runner and agent-runner may start polling Temporal and executing activities before stigmer-server is fully ready.

---

## Implementation Plan

### Fix 1: Align bootstrap status with seedpack flag file

Rewrite `GetBootstrapStatus()` in `[client-apps/cli/internal/cli/bootstrap/status.go](client-apps/cli/internal/cli/bootstrap/status.go)` to derive status from the seedpack flag file (`$dataDir/.seedpack-bootstrapped`) rather than the SQLite `bootstrap_state` table.

- If the flag file exists and contains a valid hash, status = "Completed" with the hash as version.
- If the flag file does not exist, status = "Not Started".
- Remove the SQLite dependency from this package entirely (it is dead code).
- Update `[server_status.go](client-apps/cli/cmd/stigmer/root/server_status.go)` `addBootstrapSection` to pass `dataDir` to the new function.
- Simplify the `BootstrapStatus` struct: skills/agents counts are no longer tracked at the flag-file level (they were part of the old server-side bootstrap). Display only status and seedpack hash.

### Fix 2: Add gRPC keepalive to Python channels

Create a shared channel factory module at `backend/services/agent-runner/grpc_client/channel.py` that centralizes channel creation with proper options:

```python
CHANNEL_OPTIONS = [
    ("grpc.keepalive_time_ms", 10000),
    ("grpc.keepalive_timeout_ms", 5000),
    ("grpc.keepalive_permit_without_calls", 0),
    ("grpc.http2.max_pings_without_data", 0),
]
```

Update all 8 client classes (`agent_client.py`, `agent_execution_client.py`, `session_client.py`, `agent_instance_client.py`, `skill_client.py`, `mcp_server_client.py`, `execution_context_client.py`, `environment_client.py`) to use this factory instead of directly calling `grpc.aio.insecure_channel()`.

### Fix 3: Introduce a shared channel provider for the agent-runner

Instead of creating a new channel in every client constructor (and thus per activity invocation), introduce a `ChannelProvider` that manages a single shared `grpc.aio` channel per endpoint. Clients receive the channel from the provider rather than creating their own.

- Create `backend/services/agent-runner/grpc_client/channel.py` with `ChannelProvider` class.
- Each client's `__init__` accepts an optional `channel` parameter; when provided, the client uses the shared channel instead of creating a new one.
- In `execute_graphton.py` and `generate_session_subject.py`, create a `ChannelProvider` once at the top of the activity and pass its channel to all client constructors.
- The provider handles keepalive options, connectivity state checking, and graceful close.

### Fix 4: Add gRPC readiness gate in daemon process startup

In `[daemon_process.go](client-apps/cli/internal/cli/daemon/daemon_process.go)`, after starting `stigmer-server` and before starting `workflow-runner`, add a gRPC connectivity check that waits for the server to be accepting connections. Reuse the existing `WaitForReady` logic from `daemon.go` or implement a lightweight version inline.

This prevents workflow-runner and agent-runner from polling Temporal and executing activities against a server that is not yet ready.

---

## Scope Boundary

The following are **out of scope** for this change but worth noting for follow-up:

- **Increasing the 10s timeout**: The current 10s is intentionally under Temporal's 30s heartbeat. Rather than increasing it, Fixes 2-4 should eliminate the root causes that make 10s insufficient. If timeouts persist after these fixes, we should revisit.
- **gRPC health checking in the health monitor**: Currently process-liveness only. A proper gRPC health check would catch a hung server, but that is a separate concern.
- **Removing the `bootstrap_state` SQLite table and `SetBootstrapState` code**: These are dead code after Fix 1, but cleanup can happen in a separate PR.

