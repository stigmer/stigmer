# Fix Cursor-Runner Bootstrap in Desktop Sidecar Context

**Date**: May 10, 2026

## Summary

Fixed the cursor-runner failing to start when launched from the Desktop sidecar. The dev-mode bootstrap path conflated "dev source" with "dev runtime," relying on system Node.js via PATH which is unavailable in macOS .app bundle context. Decoupled source resolution from runtime resolution so both dev and embed modes use the managed hermetic Node.js runtime.

## Problem Statement

The cursor-runner never started when the Desktop app launched the runner via its Tauri sidecar. The Desktop showed only agent-runner logs with no cursor-runner output. The runner appeared "Ready" but could not handle Cursor harness executions.

### Pain Points

- `bootstrapCursorRunnerDevMode` called `exec.LookPath("node")` which fails in macOS .app sidecar context (minimal PATH: `/usr/bin:/bin:/usr/sbin:/sbin`)
- The bootstrap error was silently caught by the goroutine with a warning log, and the cursor-runner was skipped
- `EnsureDepsInstalledWith` invoked the managed npm directly as a command, but npm's shebang (`#!/usr/bin/env node`) also resolves `node` from PATH -- same failure
- The Python agent-runner did NOT have this problem because it always uses a managed Python runtime regardless of dev/embed mode

## Solution

Decoupled source resolution from runtime resolution in the cursor-runner bootstrap:

1. **Dev mode now uses managed Node.js** -- `bootstrapCursorRunnerDevMode` creates a `nodert.Manager` (same as embed mode) to provision a hermetic Node.js runtime. Dev mode only differs in where the application source comes from (repo tree vs embedded FS), not where the runtime comes from.

2. **`EnsureDepsInstalledWith` takes both `nodeBin` and `npmBin`** -- npm is invoked as `node <npm-cli.js> install` instead of `<npm-cli.js> install`, avoiding the shebang PATH resolution. This matches how `nodert.Manager.installDeps` works internally.

3. **Extracted `ensureManagedNodeRuntime`** as a shared helper used by both dev and embed mode bootstrap paths.

## Implementation Details

### cursor.go

- Rewrote `bootstrapCursorRunnerDevMode` to use `ensureManagedNodeRuntime()` instead of `nodert.EnsureNodeAvailable()` (which calls `exec.LookPath("node")`)
- New `ensureManagedNodeRuntime()` function provisions the hermetic Node.js via `nodert.Manager`, shared between dev and embed modes
- Passes both `mgr.NodeBin()` and `mgr.NpmBin()` to `EnsureDepsInstalledWith`

### bootstrap.go

- `EnsureDepsInstalledWith` now takes `(ctx, appDir, nodeBin, npmBin)` and runs `exec.CommandContext(ctx, nodeBin, npmBin, "install", ...)`
- `EnsureDepsInstalled` updated to pass `"node", "npm"` for backward compatibility

## Benefits

- Cursor-runner starts reliably in all contexts: Desktop sidecar, CLI terminal, CI, production
- No PATH dependency for Node.js -- fully hermetic
- Matches the agent-runner's established pattern (managed runtime + source resolution)
- Dev mode still uses tsx for TypeScript hot-reload from repo source

## Impact

- **CLI runner package** (`cursor.go`): Managed Node.js for dev mode bootstrap
- **CLI nodert package** (`bootstrap.go`): Explicit node+npm binary parameters
- **All Desktop users**: Cursor-runner now starts automatically

## Related Work

- Follows "Unify Runner Logs" (commit `910c5a649`) which added `[agent]`/`[cursor]` prefixes
- Follows "Runner Orphan Prevention" (commit `9bd0cbd5b`) which added SIGHUP + orphan detection
- Part of `20260509.02.runner-management-ux-overhaul` project

---

**Status**: Production Ready
**Timeline**: 1 session
