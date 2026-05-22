# Clean Up Stale Agent-Runner / Cursor-Runner References After Unified Runner Migration

**Date**: May 22, 2026

## Summary

Removed all stale references to the deleted `agent-runner` and `cursor-runner` services across the Makefile, CLI commands, desktop sidecar script, and embedded package. This unblocks `make desktop-dev` which was failing because `setup-sidecar-dev.sh` tried to sync source from directories that no longer exist after the unified runner migration (PR #151).

## Problem Statement

The unified runner migration (PR #151) replaced the Python `agent-runner` and TypeScript `cursor-runner` with a single TypeScript runner at `backend/services/runner/`. While CI workflows were updated, several local development paths still referenced the old services.

### Pain Points

- `make desktop-dev` fails immediately — the sidecar build script tries to `cd` into deleted `embedded/agentrunner` and `embedded/cursorrunner` directories
- `make setup` fails — tries to run `poetry install` in the deleted agent-runner dir
- `make test`, `make lint`, `make fix` all reference deleted services
- `stigmer status` shows a duplicate "Agent Runner" component that reads the same PID file as the unified "Runner"
- `stigmer logs --component agent-runner` references a component that no longer exists
- `embedded/extract.go` contains ~130 lines of dead tarball extraction code
- `embedded/version.go` checks for an `agent-runner` binary that is never embedded

## Solution

Systematic cleanup of all stale references, updating them to point to the unified runner where appropriate, and removing dead code paths that existed only for the old embedding model.

## Implementation Details

- **`client-apps/desktop/scripts/setup-sidecar-dev.sh`**: Removed agent-runner/cursor-runner sync steps, removed `embed_agentrunner`/`embed_cursorrunner` build tags, removed embed hash computation. Now matches what the CI desktop release workflow does.
- **`Makefile`**: Replaced `AGENT_RUNNER_DIR`/`CURSOR_RUNNER_DIR` with `RUNNER_DIR`. Updated `setup`, `build`, `test`, `lint`, `fix` targets. Removed dead `update-deps` target. Cleared stale `DEV_LDFLAGS`.
- **`status_health.go`**: Removed duplicate PID read that registered the unified runner PID as both `"runner"` and `"agent-runner"`.
- **`status_cmd.go`**: Updated component order and labels from `agent-runner`/`workflow-runner` to `runner`.
- **`logs_cmd.go`**: Updated component validation, help text, examples, and log file configs.
- **`down.go`**: Updated help text.
- **`embedded/extract.go`**: Simplified to just maintain bin directory and version marker. Removed dead tarball extraction, binary writing, and `GetRunnerBinary()` calls.
- **`embedded/version.go`**: Removed dead `needsExtraction()` function and agent-runner binary check.

## Benefits

- `make desktop-dev` works again
- `make setup`, `make test`, `make lint`, `make fix` no longer fail on missing directories
- `stigmer status` shows a single "Runner" component instead of confusing duplicates
- ~270 lines of dead code removed
- Local dev experience matches the unified runner architecture

## Impact

- All local development Makefile targets that reference runner services
- CLI `status`, `logs`, `down` command output
- Desktop app sidecar build for local development

---

**Status**: ✅ Production Ready
