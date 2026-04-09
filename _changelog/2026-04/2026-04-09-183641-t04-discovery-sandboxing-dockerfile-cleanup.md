# T04: Connect/Discover Sandboxing and Agent-Runner Dockerfile Cleanup

**Date**: April 9, 2026

## Summary

Completed the MCP server security boundary by sandboxing stdio MCP servers in the Connect/Discover workflow and removing MCP runtimes from the agent-runner Dockerfile. With T04 done, untrusted MCP server code never executes inside the agent-runner pod in cloud mode — both agent execution (T02) and tool discovery (T04) now route stdio servers through Daytona sandboxes.

## Problem Statement

The agent-runner had two paths that executed untrusted MCP server code locally:

1. **Agent execution** — MCP servers run during agent work (addressed in T02-T03)
2. **Connect/Discover workflow** — `DiscoverMcpServerCapabilities` activity launches stdio MCP servers locally for tool discovery and approval classification

Even after T02 sandboxed agent execution, the connect/discover path still ran untrusted code in the agent-runner pod. The agent-runner Dockerfile also bundled Node.js, Go, and uvx — increasing image size and attack surface.

### Pain Points

- Untrusted marketplace MCP servers could access Temporal, Redis, MongoDB, and K8s API from the agent-runner pod during tool discovery
- Agent-runner Docker image was bloated with runtimes only needed inside sandboxes
- Security boundary was incomplete: two of two paths needed sandboxing, but only one was done

## Solution

**Ephemeral sandbox for discovery**: Create a temporary Daytona sandbox in the `discover_mcp_server` activity for stdio servers in cloud mode. The sandbox is created before discovery, used for the MCP session, and deleted immediately afterward. HTTP servers and local/OSS mode are unaffected.

**Dockerfile cleanup**: Remove all MCP runtimes (Node.js/npm/npx, Go toolchain, uv/uvx) from the agent-runner Docker image. Replace with minimal system dependencies (git, ca-certificates, curl).

## Implementation Details

### Sandbox-Aware Discovery (`discover_mcp_server.py`)

Added `_maybe_create_discovery_sandbox()` — a three-way gating function that mirrors the established `_maybe_create_daytona_mcp_client()` pattern from `setup.py`:

| Condition | Result |
|-----------|--------|
| Local/OSS mode | `(None, None)` — subprocess transport |
| Cloud mode + HTTP transport | `(None, None)` — remote endpoint |
| Cloud mode + stdio transport | Create ephemeral Daytona sandbox |

Updated `_connect_and_discover()` to accept an optional `sandbox` parameter. When present and transport is stdio, routes through `DaytonaMCPClient` instead of `MultiServerMCPClient`. The session-level code (list_tools, list_resource_templates) is identical for both paths — both client types expose the same `session()` context manager.

Sandbox cleanup happens in the activity's `finally` block via `_cleanup_discovery_sandbox()`, ensuring deletion even when discovery fails.

### Timeout Budget

Increased `start_to_close_timeout` from 300s to 600s and added `heartbeat_timeout=60s` for both `ConnectMcpServerWorkflow` and `DiscoverMcpServerWorkflow` to accommodate sandbox creation (up to 180s) + MCP init (270s).

### Dockerfile Cleanup

Removed from the runtime image:
- Node.js/npm/npx (NodeSource setup + apt install)
- Go toolchain (COPY from `golang:1.25`)
- uv/uvx (COPY from `astral-sh/uv`)
- gnupg (only needed for NodeSource GPG key)
- MCP runtime verification step
- Go cache directories and GOPATH environment variables

The agent-runner is now a pure Python orchestrator.

### Tests

13 new unit tests across 5 test classes:
- `TestMaybeCreateDiscoverySandbox` (5): gating logic for all mode/transport combinations
- `TestConnectAndDiscoverClientRouting` (4): DaytonaMCPClient vs MultiServerMCPClient selection
- `TestDiscoverySandboxCleanup` (2): success and error path cleanup
- `TestDiscoveryWorkflowTimeouts` (2): timeout budget verification

Full test suite: **1499 passed**, 21 skipped, 0 failures.

## Benefits

- **Security boundary complete**: No untrusted MCP server code executes in the agent-runner pod in cloud mode
- **Smaller Docker image**: Removed ~500MB of MCP runtimes (Node.js, Go, uvx)
- **Reduced attack surface**: Agent-runner container only has Python — no compilers, no package managers, no language runtimes
- **Consistent architecture**: Both agent execution and tool discovery use the same sandbox transport pattern

## Impact

- **Agent-runner service**: Dockerfile slimmed, discovery activity updated, workflow timeouts adjusted
- **Connect/Discover workflow**: Stdio MCP servers now run in ephemeral sandboxes in cloud mode (10-30s additional latency from snapshot-based creation)
- **Local/OSS mode**: Zero impact — continues using local subprocesses
- **HTTP MCP servers**: Zero impact — continues connecting to remote endpoints

## Related Work

- T01: Snapshot management automation (Temporal scheduled workflow)
- T02: Daytona stdio relay transport and DaytonaMCPClient wrapper
- T03: Pipeline integration validation (subsumed by T02's architecture)
- Design Decision 001: Use existing Daytona sandbox for MCP isolation
- Design Decision 002: Automated snapshot lifecycle via Temporal

---

**Status**: Production Ready
**Timeline**: 1 session (Session 4 of the mcp-server-sandbox-security project)
