# Fix Bootstrap Status Reporting and Intermittent gRPC DEADLINE_EXCEEDED

**Date**: March 4, 2026

## Summary

Two foundational issues were fixed: (1) `stigmer server status` incorrectly showed "Bootstrap: Not Started" after a successful seedpack apply because status was still reading from an orphaned SQLite table; (2) intermittent gRPC `DEADLINE_EXCEEDED` errors between the agent-runner and stigmer-server were addressed by adding client-side keepalive, shared channel reuse per activity, and a daemon startup readiness gate so workers do not run before the server accepts connections.

## Problem Statement

Users observed that after running the Stigmer server and seeing "System resources applied successfully," the `stigmer server status` command reported "Bootstrap: Not Started" with zero skills and agents applied. Separately, agent executions frequently failed with `grpc.aio._call.AioRpcError: status = StatusCode.DEADLINE_EXCEEDED` when calling the stigmer-server from the Python agent-runner, even though the server and all components showed as "Running" in status.

### Pain Points

- **Bootstrap status mismatch**: CLI bootstrap (seedpack) writes a flag file and prints success, but status read from a SQLite `bootstrap_state` table that is never populated after the seedpack migration, so users saw "Not Started" and lost trust in the status output.
- **Intermittent gRPC timeouts**: Agent-runner activities (e.g. `agent_client.get()`, `agent_execution_client.update_status()`) hit DEADLINE_EXCEEDED under load or after idle periods; the 10s per-call timeout was tight when the server was busy, and Python channels had no keepalive so idle connections could be closed by the server without the client noticing.
- **Startup race**: The daemon started workflow-runner and agent-runner immediately after launching stigmer-server with only a fixed 2s sleep, so workers could poll Temporal and run activities before the gRPC server was accepting connections.

## Solution

1. **Bootstrap status**: Align status with the actual bootstrap mechanism by reading the seedpack flag file (`$dataDir/.seedpack-bootstrapped`) instead of SQLite; remove the dead SQLite dependency from the bootstrap package.
2. **gRPC reliability**: Introduce a shared channel factory with keepalive options matching the Go server, a `ChannelProvider` for one channel per activity, and optional shared-channel support in all eight gRPC client classes; add a gRPC readiness check in the daemon after stigmer-server start before starting workers.

## Implementation Details

### Bootstrap (CLI)

- **`client-apps/cli/internal/cli/bootstrap/status.go`**: Replaced `GetBootstrapStatus()` to take `dataDir` and read the `.seedpack-bootstrapped` flag file. If the file exists with a non-empty hash, status is "completed" and the hash is exposed as seedpack version; otherwise "Not Started." Removed all SQLite usage and the old `bootstrap_state`/resource parsing.
- **`client-apps/cli/cmd/stigmer/root/server_status.go`**: `addBootstrapSection` now passes `dataDir` to `GetBootstrapStatus(dataDir)` and displays status plus optional "Seedpack Hash"; removed Skills/Agents counts that came from the old SQLite path.
- **`client-apps/cli/internal/cli/bootstrap/status_test.go`**: Tests updated for flag-file-based behaviour (temp dir, write flag, assert status/hash).
- **`client-apps/cli/internal/cli/bootstrap/BUILD.bazel`**: Dropped `@org_modernc_sqlite` dependency.

### gRPC channel factory and keepalive (agent-runner)

- **`backend/services/agent-runner/grpc_client/channel.py`** (new): Defines `KEEPALIVE_CHANNEL_OPTIONS` (e.g. 10s PING interval, 5s timeout) to align with the Go server’s keepalive enforcement; `create_channel(endpoint, interceptors)` builds secure/insecure channels with these options; `ChannelProvider(api_key)` owns a single channel (with auth interceptor) and exposes it for reuse, with `close()` for cleanup.
- **All eight gRPC clients** (`agent_client`, `agent_execution_client`, `session_client`, `agent_instance_client`, `skill_client`, `mcp_server_client`, `execution_context_client`, `environment_client`): Each accepts an optional `channel` argument; when provided, the client uses that channel and does not own it; when omitted, the client creates its own channel via `create_channel` (with keepalive) for backward compatibility.

### Activity use of shared channel

- **`worker/activities/execute_graphton.py`**: At the start of `_execute_graphton_impl`, creates one `ChannelProvider(api_key)` and passes its channel to all client constructors (Session, AgentInstance, Agent, AgentExecution, and later ExecutionContext, Environment, Skill, McpServer). Ensures `await grpc_provider.close()` in the existing `finally` block.
- **`worker/activities/generate_session_subject.py`**: Uses a single `ChannelProvider`, passes its channel to AgentExecution, Session, Agent, and AgentInstance clients, and closes the provider in a `finally` block. `_resolve_agent_id_from_session` now accepts an optional `channel` and passes it into `AgentInstanceClient`.

### Daemon readiness gate

- **`client-apps/cli/internal/cli/daemon/daemon_process.go`**: After successfully starting the `stigmer-server` component, the daemon calls `WaitForReady(ctx, "localhost:<grpcPort>")` with a 30s timeout before starting workflow-runner and agent-runner. If the server does not become ready, the daemon marks stigmer-server as failed and exits with a clear error so workers are never started against an unavailable server.

## Benefits

- **Accurate bootstrap status**: Users see "Completed" and the seedpack hash when bootstrap has run, matching the "System resources applied successfully" message and removing confusion.
- **Fewer DEADLINE_EXCEEDED errors**: Keepalive keeps connections alive and consistent with server policy; one channel per activity reduces connection churn and server load; the readiness gate avoids activities running before the server is ready.
- **Clearer startup failure**: If stigmer-server’s gRPC never becomes ready, the daemon fails fast with an explicit error instead of leaving workers to time out later.

## Impact

- **Users**: Correct bootstrap status in `stigmer server status`; more reliable agent execution with fewer intermittent gRPC timeouts.
- **Operators**: Daemon startup either succeeds with a ready server or fails with a clear "gRPC did not become ready" message.
- **Codebase**: Bootstrap package no longer depends on SQLite; agent-runner gRPC usage is centralized (channel factory + optional shared channel), improving consistency and maintainability.

## Related Work

- Seedpack-based bootstrap and removal of server-side bootstrap were introduced in the 2026-02-28 migration; this changelog fixes the status display that was left reading the old SQLite source.
- gRPC server keepalive and enforcement are configured in `backend/libs/go/grpc/server.go`; this change aligns the Python client with that configuration.
- Existing `WaitForReady` in `daemon.go` was already used by the CLI before seedpack apply; the daemon process now uses the same readiness check between stigmer-server and worker startup.

---

**Status**: ✅ Production Ready  
**Timeline**: Single implementation pass (bootstrap + gRPC + daemon gate).
