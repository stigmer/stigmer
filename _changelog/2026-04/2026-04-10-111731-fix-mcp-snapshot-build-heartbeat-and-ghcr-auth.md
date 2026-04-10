# Fix MCP Snapshot Build: Heartbeat Threading and GHCR Authorization

**Date**: April 10, 2026

## Summary

Fixed two bugs in the `BuildMcpSnapshot` Temporal activity that caused every scheduled snapshot build to fail: a `RuntimeError: Not in activity context` from calling `activity.heartbeat()` on the Daytona SDK's background log-streaming thread, and an `unauthorized` error when Daytona tried to pull the private `ghcr.io/stigmer/agent-sandbox-full:latest` base image. Added a CI guardrail to enforce public GHCR package visibility on every image push.

## Problem Statement

The MCP snapshot build pipeline, introduced in the sandbox security project (20260409.01), was failing on every scheduled run (6-hour interval) with two distinct errors visible in the `agent-runner` pod logs.

### Pain Points

- **Snapshot builds never succeed** -- every run fails, so sandboxes never get the pre-installed MCP server packages, forcing cold-start downloads on first use
- **Noisy error logs** -- the Temporal heartbeat `RuntimeError` spams the pod logs on every build attempt, obscuring the real issue
- **Non-actionable error messages** -- the `unauthorized` GHCR error was buried inside a generic "Snapshot creation failed" log with no guidance on resolution

## Solution

1. **Heartbeat threading fix**: Removed `activity.heartbeat()` from the `_on_logs` callback (called on the Daytona SDK's background thread) and wrapped the blocking `daytona.snapshot.create()` and `_rotate_snapshots()` calls with the existing `run_sync_with_heartbeat` utility, which dispatches sync work to a thread and heartbeats from the async activity loop.

2. **GHCR visibility**: Made the `agent-sandbox-full` package public via the GitHub UI and added a CI guardrail step to `release.sandbox-cloud.yaml` that enforces public visibility after every image push.

3. **Actionable error messaging**: When the snapshot build fails with an "unauthorized" error, a targeted log message now directs operators to check GHCR package visibility or Daytona registry credentials.

## Implementation Details

### Heartbeat Threading (build_mcp_snapshot.py)

The Daytona SDK's `snapshot.create()` method internally spawns a `Thread` for log streaming (`daytona._sync.snapshot.start_log_streaming`). The `_on_logs` callback was invoking `activity.heartbeat()` from this thread, but the Temporal Python SDK requires heartbeats to originate from the activity's execution context.

The fix reuses `run_sync_with_heartbeat` from `temporal_helpers.py` -- the same pattern already used by `execute_graphton`, `discover_mcp_server`, and `SandboxManager`. This runs blocking Daytona API calls in `asyncio.to_thread` while the async loop sends heartbeats every 30 seconds.

Both `daytona.snapshot.create()` and `_rotate_snapshots()` (which calls `snapshot.list` and `snapshot.delete`) are now wrapped, ensuring no blocking calls remain on the async event loop.

### GHCR Visibility Guardrail (release.sandbox-cloud.yaml)

Normal `docker push` to an existing GHCR package does not change its visibility. However, if the package is ever deleted and recreated (org cleanup, repo transfer), GHCR defaults to private. The new CI step calls the GitHub API to enforce public visibility after every push -- idempotent and no additional permissions required (`packages: write` is already present).

## Benefits

- **Snapshot builds succeed** -- the pipeline can now create Daytona snapshots with pre-installed MCP server packages, eliminating cold-start latency for marketplace MCP servers
- **Clean pod logs** -- no more `RuntimeError: Not in activity context` noise on every scheduled run
- **Faster diagnosis** -- unauthorized errors now include a targeted remediation message pointing to GHCR visibility or Daytona registry configuration
- **Regression-proof** -- CI enforces public visibility on every image push

## Impact

- **agent-runner**: Snapshot build activity works correctly for the first time since deployment
- **End users**: MCP servers pre-installed in snapshots means near-zero cold start when connecting marketplace MCP servers
- **Operations**: Cleaner logs, actionable error messages, no manual GHCR visibility management needed

## Related Work

- [Polyglot MCP Snapshot Workflow](_changelog/2026-04/2026-04-09-192355-polyglot-mcp-snapshot-workflow.md) -- the Java/Python workflow this activity belongs to
- [Sandbox Full CI Pipeline](_changelog/2026-04/2026-04-09-164211-sandbox-full-ci-pipeline-and-snapshot-integration-tests.md) -- the CI workflow that publishes the base image
- Project: [20260409.01.mcp-server-sandbox-security](_projects/2026-04/20260409.01.mcp-server-sandbox-security/README.md) -- parent project

---

**Status**: Production Ready
**Timeline**: ~1 hour
