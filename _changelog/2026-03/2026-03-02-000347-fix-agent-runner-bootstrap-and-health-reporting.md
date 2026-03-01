# Fix Agent Runner Bootstrap Pipeline and Startup Health Reporting

**Date**: March 2, 2026

## Summary

Fixed a critical bug where the native Agent Runner crashed immediately on startup with `ModuleNotFoundError: No module named 'dotenv'` because the hermetic Python runtime's dependency installation pipeline was never wired up. Also fixed two UX issues where `stigmer server` silently reported "Ready!" despite Agent Runner failure and `stigmer server status` showed crashed components as running. Removed ~1,350 lines of dead code left over from the Docker-to-native migration.

## Problem Statement

After migrating Agent Runner from Docker to a native Python process, running `stigmer server` showed the server was "Ready!" while the Agent Runner was crashing on every startup attempt. The daemon restarted it repeatedly (up to 5 times over ~50 seconds) before giving up, but the user was never informed.

### Pain Points

- `bootstrapAgentRunnerRuntime()` created `pythonrt.Manager` without setting `DepsSource` — the venv was created but zero packages were installed
- `sync.sh` copied the wrong path for `graphton` (`$GRAPHTON/graphton` instead of `$GRAPHTON/src/graphton`), silently failing because errors were suppressed
- `handleServerStart()` only waited for the gRPC server to become ready, then printed "Ready!" — component health was never checked
- The health monitor's retry loop wasted ~50 seconds retrying structural failures (missing imports) that would never self-heal
- ~1,350 lines of dead code from the Docker era remained in the codebase (unused `health/` package, dead `startAgentRunnerNative`, etc.)

## Solution

Three-layer fix: (1) wire up dependency installation so Agent Runner actually starts, (2) surface component failures to the user at startup, (3) detect structural crashes instantly instead of retrying.

## Implementation Details

### 1. Dependency Installation Pipeline

- Generated `backend/services/agent-runner/requirements.txt` with 131 pinned PyPI dependencies from `poetry show --only main`. Added `make update-agent-runner-deps` target for regeneration.
- Reordered `pythonrt.Manager.bootstrap()` to run `extractAppSource()` before `setupVenv()` so `requirements.txt` is on disk when pip runs.
- Added `Manager.SetDeps()` method to configure `DepsSource` (path to requirements.txt) and `PostInstallCmds` (pip install for path dependencies) after manager creation.
- Added `PreInstallFn` callback to `pythonrt.Config` for dev-mode copying of monorepo path dependencies (graphton, stigmer-stubs) into the app directory.
- Fixed `sync.sh` graphton copy path and added `requirements.txt` to the sync.

### 2. Startup Health Reporting

- Added `reportDegradedComponents()` to `handleServerStart()` — after gRPC readiness, reads `health-state.json` and warns about any component in "failed" or "stopped" state with error details and log viewing instructions.

### 3. Rapid-Crash Detection

- Added `rapidCrashWindow` (5 seconds) to the health monitor. Components crashing within this window of their start are immediately marked as "failed" without retry, since the crash is almost certainly a structural issue (missing deps, config errors) that restarts cannot fix.

### 4. Dead Code Removal

- Removed `startAgentRunnerNative()`, `buildNativeAgentRunnerEnv()`, `tailBytes()` and their test file (dead code from earlier migration attempt)
- Deleted the entire `internal/cli/health/` package (6 files, ~1,350 lines) — unused, no importers
- Updated Docker-era comments in `embedded/extract.go` to reflect native architecture

## Benefits

- **Agent Runner actually starts**: Full dependency installation pipeline ensures all 131+ Python packages are installed in the hermetic venv
- **Honest startup reporting**: Users immediately see which components failed, with error messages and log instructions
- **Fast failure detection**: Structural crashes are caught in under 5 seconds instead of 50+ seconds of futile retries
- **Cleaner codebase**: 1,670 lines deleted vs 195 added (net -1,475 lines)
- **Reproducible deps**: `make update-agent-runner-deps` regenerates requirements.txt from poetry.lock — no manual curation needed for future dependency changes

## Impact

- **End users**: `stigmer server` will correctly install Agent Runner dependencies and surface any startup failures immediately
- **Developers**: `make release-local && stigmer server` now follows a clear bootstrap pipeline; stale Docker-era code is gone
- **CI/CD**: `sync.sh` correctly bundles requirements.txt and graphton for embedded production builds

## Related Work

- [Consolidate Lifecycle Management](2026-03-01-194354-consolidate-lifecycle-management-single-daemon.md) — the daemon and health-state.json infrastructure that this fix builds upon
- [Native Agent Runner Process Mode](2026-03-01-183330-native-agent-runner-process-mode.md) — the original T01.4 implementation where DepsSource was overlooked
- [Python Runtime Manager](2026-03-01-174505-python-runtime-manager.md) — the pythonrt.Manager that this fix extends with SetDeps and PreInstallFn
- [Fix Dev-Mode Source Detection](2026-03-01-231918-fix-dev-mode-agent-runner-source-detection.md) — the dev-mode ldflags fix from Session 4

---

**Status**: ✅ Production Ready (pending end-to-end validation)
**Timeline**: ~3 hours
