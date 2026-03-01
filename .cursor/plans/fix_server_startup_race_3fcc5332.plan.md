---
name: Fix Server Startup Race
overview: Add a readiness gate between `StartWithOptions()` (which spawns the server and returns immediately) and `EnsureSeedpackBootstrapped()` / `runBootstrapDiscovery()` in the server startup path. The gRPC server on port 7234 is the last component to start in the backend, so waiting for it to accept connections guarantees all subsystems (SQLite, controllers, Temporal workers, supervisor) are initialized.
todos:
  - id: add-phase-const
    content: Add PhaseReady progress phase constant in cliprint/progress.go
    status: completed
  - id: add-readiness-gate
    content: Add WaitForReady() call with 60s timeout between StartWithOptions() and EnsureSeedpackBootstrapped() in handleServerStart(), integrated with progress display
    status: completed
  - id: verify-build
    content: Verify the CLI builds cleanly and check for lint errors
    status: completed
isProject: false
---

# Fix Server Startup Race Condition

## Diagnosis

### Primary Issue: Race Between Server Spawn and Seedpack Apply

In `[server.go](client-apps/cli/cmd/stigmer/root/server.go)`, `handleServerStart()` has a critical race:

```159:196:client-apps/cli/cmd/stigmer/root/server.go
	if err := daemon.StartWithOptions(dataDir, daemon.StartOptions{
		// ... options ...
	}); err != nil {
		// ...
	}

	// ... progress stop, LLM status ...

	// These run IMMEDIATELY, but the server isn't listening yet:
	if err := daemon.EnsureSeedpackBootstrapped(dataDir); err != nil {
		climsg.Warning("Failed to apply system resources: %v", err)
	}
	climsg.Info("Discovering MCP server capabilities...")
	runBootstrapDiscovery(cfg)
```

- `StartWithOptions()` spawns `stigmer internal-server` as a detached process and returns immediately (line 391-393 of `daemon.go`)
- The backend server starts gRPC on port 7234 as the **very last step** (line 452-456 of `server.go`), after initializing SQLite, all controllers, Temporal workers, search index, and supervisor
- `EnsureSeedpackBootstrapped()` runs `stigmer apply --config <tmpDir>` which tries `NewConnection()` with a 10-second timeout -- not enough for a cold start that can take 15-30+ seconds
- Result: `context deadline exceeded`

### Secondary Issue (from `stigmer logs`)

The Temporal log shows a port binding conflict on 7233, and the workflow-runner experienced degradation with repeated `context deadline exceeded` polling errors. These are operational/cleanup issues, separate from the race condition, but worth noting.

### Why `WaitForReady` Exists But Isn't Used Here

A previous change (2026-01-21, see `[_changelog](_changelog/2026-01/2026-01-21-014002-fix-grpc-connection-race-condition.md)`) removed `WaitForReady()` from `EnsureRunning()` because `grpc.WithBlock()` in `NewConnection()` was supposed to handle waiting. That works fine for the **multi-terminal scenario** (server already up, client connects). But it doesn't work for the **single-command startup scenario** where the server was JUST spawned and needs 15-30s to initialize -- the 10-second `NewConnection()` timeout is simply too short.

## The Fix

### 1. Add readiness gate in `handleServerStart()` with progress integration

In `[server.go](client-apps/cli/cmd/stigmer/root/server.go)`, between `StartWithOptions()` and `EnsureSeedpackBootstrapped()`, call `daemon.WaitForReady()` with a 60-second timeout. Integrate it with the existing progress display so users see a spinner during the wait rather than a frozen terminal.

**Before** (current flow):

```
StartWithOptions() -> progress.Stop() -> seedpack -> discovery
```

**After** (proposed flow):

```
StartWithOptions() -> WaitForReady(60s, with progress phase) -> progress.Stop() -> seedpack -> discovery
```

Specifically, move `progress.CompletePhase()` and `progress.Stop()` AFTER the readiness check, and add a new progress phase for the wait. This way the startup progress spinner remains active while the server initializes, and the user sees:

```
  ✓ Deploying: done
  ✓ Starting services: done          <-- existing
  ✓ Waiting for readiness: done      <-- NEW
✓ Using anthropic with model claude-sonnet-4.6
ℹ Applying system resources (seedpack)...
```

If `WaitForReady` fails (timeout), stop progress, report the error clearly, and return early -- no point trying seedpack/discovery against a dead server.

### 2. Add `PhaseReady` progress phase

In `[progress.go](client-apps/cli/internal/cli/cliprint/progress.go)`, add a new exported phase constant for the readiness wait. This is a minor addition -- just one line in the const block.

### 3. Do NOT change `NewConnection()` timeout

The 10-second timeout in `[client.go](client-apps/cli/internal/cli/backend/client.go)` is appropriate for normal operations when the server is already running. The startup path is the special case, and it should be handled at the call site (`handleServerStart`), not by inflating the global connection timeout.

## What This Does NOT Change

- `EnsureRunning()` path (used by `stigmer apply`, `stigmer run`, etc.) -- these already handle the case where the server is running; if it's not, they start it and have their own flow
- `NewConnection()` timeout -- remains 10s for normal client usage
- The `WaitForReady()` function itself -- already exists and is correct
- Backend server startup order -- no changes needed there

## Files to Modify

- `[client-apps/cli/cmd/stigmer/root/server.go](client-apps/cli/cmd/stigmer/root/server.go)` -- add `WaitForReady()` call with progress integration in `handleServerStart()`
- `[client-apps/cli/internal/cli/cliprint/progress.go](client-apps/cli/internal/cli/cliprint/progress.go)` -- add `PhaseReady` constant

