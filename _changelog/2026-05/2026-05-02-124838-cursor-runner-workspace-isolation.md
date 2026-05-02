# Cursor Runner Workspace Isolation: Preventing Implementation Detail Leakage

**Date**: May 2, 2026

## Summary

Fixed a workspace isolation failure where the cursor-runner exposed its own internal file structure (dist/, node_modules/, model-registry.json, proto stubs) to the AI model when a session had no explicit workspace entries. Implemented a 5-layer defense-in-depth approach that enforces a hard boundary between the runner's execution environment and the agent's observable workspace.

## Problem Statement

When a user asked "What files do we have in the workspace?" through a Cursor-powered agent execution, the AI revealed the cursor-runner's own implementation files and raw installation path (`~/.stigmer/runtimes/cursor-runner/<version>/<arch>/app`). This is the platform equivalent of a Docker container leaking the Docker daemon's internal files.

### Pain Points

- The runner's compiled source (dist/), dependencies (node_modules/), and data files (model-registry.json) were visible to the agent
- Internal installation paths were exposed in prompt workspace context
- The issue surfaced when sessions lacked explicit workspace entries, triggering a fallback to `process.cwd()` -- the runner's own app directory

## Root Cause

Three failures combined:

1. **Process cwd = app dir**: The CLI daemon started the cursor-runner child process with `cmd.Dir = cursorAppDir`, making `process.cwd()` the runner's source tree
2. **Dangerous fallback**: `config.ts` used `process.env.WORKSPACE_ROOT_DIR ?? process.cwd()` -- when the env var was unset (dev mode, testing), the fallback was the runner's app directory
3. **No path validation**: Blueprint resolver and prompt builder passed raw paths to the Cursor agent without checking whether they pointed at runner internals

## Solution

Five layers of defense, each independently sufficient but combined for depth:

### Layer 1: .cursorignore

Added a `.cursorignore` file to the cursor-runner's app directory with `*` (ignore everything). Even if the workspace accidentally resolves to the runner's dir, no files are discoverable by the Cursor agent. Updated `sync.sh` to include this file in the embedded build pipeline.

### Layer 2: Safe Workspace Fallback

Replaced `process.cwd()` fallback in `config.ts` with `resolveWorkspaceRootDir()` that creates `~/.stigmer/workspaces/cursor-runner/` as an isolated directory. Falls back to `os.tmpdir()` if the home directory is unavailable. Logs a warning when the fallback fires.

### Layer 3: Process cwd Separation

Changed the CLI daemon to start the cursor-runner with `cmd.Dir = workspaceDir` (the `WORKSPACE_ROOT_DIR` path) instead of `cursorAppDir`. Entry point args are made absolute via `filepath.Join(cursorAppDir, arg)` so Node.js can find the entry point from any cwd.

### Layer 4: Prompt Sanitization

Added `sanitizeWorkspaceDirs()` in `prompt-builder.ts` that filters out any workspace dir containing runner-internal path markers (`/runtimes/cursor-runner/`, `/runtimes/agent-runner/`, `/node_modules/`, `/dist/main.js`) before embedding them in the `<workspace>` prompt section.

### Layer 5: Blueprint Validation

Added `validateWorkspaceDir()` in `blueprint-resolver.ts` that rejects paths containing runner-internal markers at resolution time, both for session workspace entries and the fallback directory. Invalid paths are logged and excluded.

## Implementation Details

| File | Change |
|------|--------|
| `backend/services/cursor-runner/.cursorignore` | New: ignore all files |
| `client-apps/cli/embedded/cursorrunner/sync.sh` | Copy `.cursorignore` into embedded source |
| `backend/services/cursor-runner/src/config.ts` | `resolveWorkspaceRootDir()` with safe fallback |
| `client-apps/cli/internal/cli/daemon/daemon_process.go` | Absolute entry args, workspace cwd |
| `backend/services/cursor-runner/src/adapter/prompt-builder.ts` | `sanitizeWorkspaceDirs()` path filtering |
| `backend/services/cursor-runner/src/adapter/blueprint-resolver.ts` | `validateWorkspaceDir()` path validation |
| `backend/services/cursor-runner/src/__tests__/config.test.ts` | Updated test for safe fallback behavior |

## Benefits

- Runner internals (source code, dependencies, pricing data) are never visible to the AI model
- Defense-in-depth: any single layer prevents the leakage independently
- The architectural boundary between runner environment and agent workspace is now enforced, not assumed
- Warning logs surface misconfigurations visibly rather than silently leaking data

## Impact

- **Direct users**: Agents no longer reveal platform implementation details when asked about workspace files
- **Platform builders**: Embedded Stigmer agents maintain clean workspace isolation in all deployment modes
- **Security**: Internal file paths and data files (model-registry.json with pricing data) are no longer observable
- **Agent-runner (Python)**: Not affected -- already has stronger workspace isolation via `FilesystemBackend` with containment checks and `.gitignore` filtering

## Related Work

- Cursor harness initial implementation (2026-05-01 changelogs)
- Agent-runner workspace provisioning (`WorkspaceProvisioner`, `LocalWorkspaceBackend`)
- Graphton `FilesystemBackend` containment model (the pattern this fix aligns cursor-runner with)

---

**Status**: ✅ Production Ready
