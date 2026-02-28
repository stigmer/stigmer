# Fix Server Startup Race Condition

**Date**: March 1, 2026

## Summary

Fixed a race condition where seedpack bootstrap and MCP discovery failed with `context deadline exceeded` because they ran before the gRPC server was ready. Added a readiness gate (`WaitForReady`) between process spawn and post-startup tasks, integrated with the CLI progress display.

## Problem Statement

Running `stigmer server` would frequently produce these warnings:

```
ℹ Applying system resources (seedpack)...
Error: failed to connect to backend: failed to connect to localhost:7234: context deadline exceeded
⚠ Failed to apply system resources: failed to apply seedpack: exit status 1
⚠ Skipping MCP discovery: failed to connect to localhost:7234: context deadline exceeded
```

### Pain Points

- Seedpack resources (agents, skills, MCP servers) were not applied on server start, requiring a manual re-run.
- MCP server capability discovery was skipped entirely.
- The errors appeared on every cold start and every restart, making it look like the server was broken even though it was running fine moments later.

## Solution

Inserted a `daemon.WaitForReady()` call with a 60-second timeout between `StartWithOptions()` (fire-and-forget process spawn) and the seedpack/discovery steps. The gRPC listener on port 7234 is the last component to start in the backend server process — after SQLite, all controllers, Temporal workers, search index rebuild, and supervisor — so a successful `WaitForReady` connection guarantees full readiness.

The wait is integrated into the existing progress spinner so users see a "Waiting for services" phase instead of a frozen terminal.

## Implementation Details

### `client-apps/cli/internal/cli/cliprint/progress.go`

Added `PhaseReady` progress phase constant to the existing phase enum.

### `client-apps/cli/cmd/stigmer/root/server.go`

In `handleServerStart()`, between `StartWithOptions()` and `EnsureSeedpackBootstrapped()`:

1. Set a "Waiting for services" progress phase.
2. Call `daemon.WaitForReady()` with a 60-second context timeout.
3. On success, complete the progress phase and proceed to seedpack + discovery.
4. On failure, stop progress, report a clear error, and return early.

The previous code called `progress.CompletePhase(PhaseDeploying)` and `progress.Stop()` immediately after `StartWithOptions()` returned, then ran seedpack and discovery against a server that wasn't listening yet.

### What was NOT changed

- `NewConnection()` timeout remains 10 seconds — appropriate for normal operations when the server is already running.
- `WaitForReady()` function itself — already existed with the correct `grpc.WithBlock()` pattern.
- `EnsureRunning()` path — used by other commands, handles its own lifecycle.
- Backend server startup order — no changes needed.

## Benefits

- Server startup is reliable regardless of how long initialization takes.
- System resources (agents, skills, MCP servers) are consistently applied on every start.
- MCP discovery runs against a fully-ready server.
- Users see clear progress feedback during the wait instead of a silent pause followed by errors.

## Impact

- **Users**: No more spurious `context deadline exceeded` errors on `stigmer server`. Seedpack and MCP discovery work on first start.
- **Developers**: No new abstractions or API changes. The fix uses the existing `WaitForReady` function that was already in the codebase but not called in this path.

## Related Work

- [2026-01-21: Fix gRPC Connection Race Condition](_changelog/2026-01/2026-01-21-014002-fix-grpc-connection-race-condition.md) — Introduced `grpc.WithBlock()` and removed `WaitForReady` from `EnsureRunning()`. That fix addressed the multi-terminal scenario; this fix addresses the single-command startup scenario where the 10-second `NewConnection` timeout is insufficient for a cold start.

---

**Status**: ✅ Production Ready
