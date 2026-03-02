---
name: Fix server progress messages
overview: Fix the misleading progress messages shown during `stigmer server` startup by making `ProgressDisplay` configurable and redefining the server startup phases to accurately reflect what is happening.
todos:
  - id: progress-config
    content: Add PhaseConfig type and NewProgressDisplayWithPhases constructor to progress.go; replace hardcoded phaseOrder with stored config
    status: completed
  - id: server-phases
    content: Define server-specific PhaseConfig in server.go; remove premature PhaseStarting; fix PhaseReady handling to use PhaseStarting with updated detail
    status: completed
  - id: daemon-reorder
    content: "Reorder daemon.go: move Python bootstrap before Temporal start; remap phases (Deploying->Installing for Python, Deploying->Starting for Temporal start and daemon launch)"
    status: completed
  - id: llm-phases
    content: Change llm/setup.go PhaseStarting to PhaseInstalling for Ollama server start
    status: completed
  - id: verify
    content: Build and verify the output looks correct with stigmer server
    status: completed
isProject: false
---

# Fix Server Startup Progress Messages

## Problem

The `stigmer server` output currently shows:

```
  @ Deploying: Bootstrapping Python Runtime
  v Initializing: done
  v Installing dependencies: done
  v Starting services: done
```

Every line is misleading:

- **"Deploying"** -- nothing is being deployed; a local Python runtime is being bootstrapped
- **"Starting services: done"** -- no services have started; this was the initial "Preparing environment" phase, auto-completed when `PhaseInitializing` was set, but rendered last due to hardcoded `phaseOrder`
- **"Installing dependencies: done"** -- used for "Setting up Temporal", not installing pip/npm deps
- **Display order is inverted** -- completed phases appear below the active spinner because `phaseOrder` in `[progress.go](client-apps/cli/internal/cli/cliprint/progress.go)` doesn't match the execution sequence

## Root Cause

`[progress.go](client-apps/cli/internal/cli/cliprint/progress.go)` hardcodes a single global `phaseOrder` (lines 139-152) designed for cloud deployment flows. The `stigmer server` command uses these same phases in a completely different order with different semantics, producing incorrect output.

## Solution: Make ProgressDisplay phase-configurable

### 1. Extend `ProgressDisplay` to accept custom phase configs

In `[client-apps/cli/internal/cli/cliprint/progress.go](client-apps/cli/internal/cli/cliprint/progress.go)`:

- Add a `PhaseEntry` struct and `PhaseConfig` type:

```go
  type PhaseEntry struct {
      Phase ProgressPhase
      Label string
  }
  type PhaseConfig []PhaseEntry
  

```

- Add `NewProgressDisplayWithPhases(config PhaseConfig)` that stores the config and passes it to `progressModel`
- Replace the two hardcoded `phaseOrder` slices in `View()` (line 139) and `renderFinalState()` (line 192) with the stored config
- Keep `NewProgressDisplay()` with the existing default config for backward compatibility (used by `EnsureRunning` at `daemon.go:503` and `server_llm.go:256`)

### 2. Define server-specific phases in `server.go`

In `[client-apps/cli/cmd/stigmer/root/server.go](client-apps/cli/cmd/stigmer/root/server.go)`:

- Define a server phase config that matches the actual startup lifecycle:

```go
  serverPhases := cliprint.PhaseConfig{
      {cliprint.PhaseInitializing, "Initializing"},
      {cliprint.PhaseInstalling, "Installing"},
      {cliprint.PhaseStarting, "Starting"},
  }
  

```

- Use `NewProgressDisplayWithPhases(serverPhases)` instead of `NewProgressDisplay()` (line 146)
- Remove `progress.SetPhase(cliprint.PhaseStarting, "Preparing environment")` (line 148) -- the first phase should be set by `StartWithOptions`, not prematurely at the call site
- After `StartWithOptions` returns, keep `PhaseStarting` active with updated detail "Waiting for server to become ready" instead of switching to `PhaseReady`
- When gRPC check passes, call `CompletePhase(PhaseStarting)` then `Stop()`

### 3. Fix phase usage and execution order in `daemon.go`

In `[client-apps/cli/internal/cli/daemon/daemon.go](client-apps/cli/internal/cli/daemon/daemon.go)`, remap the phases to match reality:

**Phase 1 -- Initializing** (quick, always runs):

- "Setting up data directory" (line 76) -- keep as `PhaseInitializing`
- "Extracting binaries" (line 83) -- keep as `PhaseInitializing`
- "Loading configuration" (line 94) -- keep as `PhaseInitializing`
- "Gathering credentials" (line 138) -- keep as `PhaseInitializing`

**Phase 2 -- Installing** (slow on first run, fast/skipped on subsequent):

- "Setting up local LLM" (line 114) -- change to `PhaseInstalling`
- "Setting up Temporal" (line 157) -- keep as `PhaseInstalling`
- "Bootstrapping Python runtime" (line 197) -- change to `PhaseInstalling`

**Phase 3 -- Starting** (always runs):

- "Starting Temporal server" (line 172) -- change to `PhaseStarting`
- "Launching Stigmer server" (line 185) -- change to `PhaseStarting` and fix label from "Starting Stigmer server" to "Launching Stigmer server"

**Reorder execution** to group install operations together and start operations together. Move Python runtime bootstrap (line 197-207) before Temporal start (line 172-178). These are independent -- Python bootstrap needs configDir and sourceFS; Temporal start needs dataDir and port. Neither depends on the other. This reorder is safe and also reduces idle time for Temporal (it starts just before the daemon spawns, rather than sitting idle during Python bootstrap).

### 4. Fix LLM setup phases

In `[client-apps/cli/internal/cli/llm/setup.go](client-apps/cli/internal/cli/llm/setup.go)`:

- Change `PhaseStarting` (line 151, "Starting local LLM server") to `PhaseInstalling` -- starting Ollama is part of installing/setting up the LLM provider, not starting Stigmer services
- Keep `PhaseInstalling` (line 288, "Downloading model") as-is -- already correct

This ensures all LLM setup activity stays within the "Installing" phase during server startup.

## Expected Output After Fix

```
i Starting Stigmer server...

  v Initializing: done
  v Installing: done
  @ Starting: Launching Stigmer server
```

Then on completion:

```
i Starting Stigmer server...

  v Initializing: done
  v Installing: done
  v Starting: done

v Ready! Stigmer server is running
  PID:  12345
  Port: 7234
  Data: ~/.stigmer/data
```

## Files Changed

- `[client-apps/cli/internal/cli/cliprint/progress.go](client-apps/cli/internal/cli/cliprint/progress.go)` -- add PhaseConfig, configurable constructor, use config in View/renderFinalState
- `[client-apps/cli/cmd/stigmer/root/server.go](client-apps/cli/cmd/stigmer/root/server.go)` -- define server phases, use configurable constructor, fix PhaseReady handling
- `[client-apps/cli/internal/cli/daemon/daemon.go](client-apps/cli/internal/cli/daemon/daemon.go)` -- remap phases to correct semantics, reorder Python bootstrap before Temporal start
- `[client-apps/cli/internal/cli/llm/setup.go](client-apps/cli/internal/cli/llm/setup.go)` -- change PhaseStarting to PhaseInstalling

