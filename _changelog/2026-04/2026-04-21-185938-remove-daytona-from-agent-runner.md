# Remove Daytona SDK from Agent-Runner

**Date**: April 21, 2026

## Summary

Eliminated the Daytona Python SDK dependency from agent-runner entirely, making it a lightweight local-execution engine. Sandbox lifecycle management moved to stigmer-service (Java). MCP server packages are now baked into the Docker image, replacing the polyglot snapshot build pipeline. A CI cache-warming step ensures sub-2-second sandbox creation in production.

## Problem Statement

The agent-runner had deep coupling to the Daytona SDK for sandbox management, MCP server transport, workspace file operations, and snapshot resolution. This created:

### Pain Points

- **~2,200 lines of Daytona SDK code** in the runner: SandboxManager, DaytonaWorkspaceBackend, DaytonaMCPClient, DaytonaTransport, SnapshotResolver, BuildMcpSnapshot activity, CleanupSandbox activity
- **Redundant responsibility**: with DaytonaSandboxRunnerLauncher in stigmer-service, the runner was already inside a sandbox — yet it still used the Daytona SDK to manage nested sandboxes and remote file operations
- **Over-engineered MCP snapshot pipeline**: a polyglot Java schedule + Java resolve activity + Python build activity + Daytona snapshot API + rotation logic + resolver cache, solving a 3-10 second first-run download
- **Staleness gap**: new GHCR image pushes didn't automatically update the Daytona snapshot — new sandboxes ran stale code until the schedule fired

## Solution

Made the runner Daytona-free by leveraging the fact that it runs inside the sandbox. From the runner's perspective, everything is local: workspace is local filesystem, MCP stdio servers are local subprocesses.

## Implementation Details

### stigmer repo (agent-runner)

**Dockerfile updated** — baked 12 npm and 6 pip seedpack MCP server packages directly into `Dockerfile.sandbox.full`. No more runtime snapshot layering.

**8 files deleted (~2,200 lines):**
- `worker/sandbox_manager.py` (571 lines)
- `worker/snapshot_resolver.py` (186 lines)
- `worker/workspace/daytona.py` (335 lines)
- `worker/mcp/daytona_mcp_client.py` (110 lines)
- `worker/mcp/daytona_transport.py` (313 lines)
- `worker/activities/cleanup_sandbox.py` (44 lines)
- `worker/activities/build_mcp_snapshot.py` (366 lines)
- `worker/sandbox_manager_daytona_only.py.backup` (239 lines)

**Core code simplified:**
- `config.py` — `sandbox_type`/`sandbox_root_dir` replaced with `workspace_root_dir`; `get_sandbox_config()` replaced with `get_workspace_config()`; snapshot resolver init removed
- `workspace/__init__.py` — always uses `LocalWorkspaceBackend`; no more SandboxManager or DaytonaWorkspaceBackend
- `discover_mcp_server.py` — always uses `MultiServerMCPClient`; no ephemeral discovery sandbox
- `graphton/setup.py` — `DaytonaMCPClient` removed; always `MultiServerMCPClient`
- `worker.py` — `build_mcp_snapshot` and `cleanup_sandbox` activities unregistered
- `daytona` SDK removed from `pyproject.toml`; `poetry.lock` regenerated

**7 Daytona test files deleted, 1 rewritten** for the new `get_workspace_config()` API.

### stigmer-cloud repo

**MCP snapshot pipeline deleted (13 Java files):** McpSnapshotScheduleRegistrar, BuildMcpSnapshotWorkflowImpl, ResolveSnapshotPackagesActivityImpl, all models, configs, and types.

**CleanupSandbox pipeline deleted (8 Java files, 3 edited):** Removed from session deletion and execution completion paths. DeprovisionInfrastructureStep (heartbeat-based) is the replacement.

**DaytonaSandboxRunnerLauncher updated:** switched from `CreateSandboxFromSnapshotParams` to `CreateSandboxFromImageParams` using the GHCR image directly. Added `WORKSPACE_ROOT_DIR=/workspace` to runner env vars. Snapshot resolution logic removed.

### CI Pipeline

**Cache-warming step** added to `release.sandbox-cloud.yaml`: after GHCR push, creates and deletes a throwaway sandbox to warm Daytona's image cache. Cold pull (53s) absorbed by CI; all production sandbox creations are ~1.6s.

## Benefits

- **Agent-runner is Daytona-free**: no `daytona` or `daytona-api-client` Python dependency
- **2,200 fewer lines** of sandbox management code in the runner
- **Single pipeline**: push to main -> GHCR image -> production sandboxes (no intermediate snapshot layer)
- **No staleness gap**: new images take effect immediately after CI cache warming
- **Simpler mental model**: the runner always uses local workspace/subprocess, whether on a laptop or in a cloud sandbox

## Impact

- **agent-runner**: Major simplification. Config fields renamed (`workspace_root_dir` replaces `sandbox_type`/`sandbox_root_dir`). Tests updated. Poetry lock regenerated.
- **stigmer-service**: Launcher creates sandboxes from images instead of snapshots. MCP snapshot schedule removed. CleanupSandbox workflow chain removed.
- **CI**: New cache-warming step adds ~60s to pipeline but eliminates 53s first-user latency.

## Related Work

- Session 9: RunnerLauncher abstraction (DaytonaSandboxRunnerLauncher)
- Session 12: DeprovisionInfrastructureStep (heartbeat-based cleanup)
- Session 14: Unified sandbox image optimization (995 MB)

---

**Status**: Production Ready
**Timeline**: Session 15 of 20260420.01.agent-runner-as-resource
