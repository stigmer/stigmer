# Fix Dev-Mode Agent-Runner Source Detection

**Date**: March 1, 2026

## Summary

Fixed a bug where `make release-local && stigmer server` failed with "agent-runner Python source is not available". The dev-mode source detection walked up from the executable's installed location (`~/bin/`), which is outside the repo tree. The fix injects the source path at build time via `-ldflags`, following the existing `buildVersion` pattern.

## Problem Statement

After the native agent-runner migration, running `make release-local` followed by `stigmer server` failed at the "Starting services" phase with:

```
x Failed to start server
Error: agent-runner Python source is not available
```

### Pain Points

- `make release-local` was unusable for testing the native agent-runner flow
- The error message gave no hint about why the source wasn't found
- Developers had to know about the `STIGMER_AGENT_RUNNER_SOURCE_DIR` env var workaround

## Solution

Inject the agent-runner source directory path into the binary at build time via Go's `-ldflags` mechanism. The Makefile knows `$(CURDIR)` at build time, so it passes the absolute path to `backend/services/agent-runner/` into a package-level variable in `agentrunner_dev.go`.

## Implementation Details

**`client-apps/cli/embedded/agentrunner/agentrunner_dev.go`**:
- Added `var devSourceDir string` — populated via `-ldflags` at build time
- Restructured `locateRepoSource()` with a clear 3-tier resolution order:
  1. `devSourceDir` (ldflags-injected, set by `make release-local`)
  2. Walk up from `os.Executable()` (works when binary is inside repo tree)
  3. `STIGMER_AGENT_RUNNER_SOURCE_DIR` env var (manual override)
- Added debug logging for all resolution paths

**`Makefile`**:
- Added `DEV_LDFLAGS` variable with the `-X` flag for `devSourceDir`
- Updated `release-local` target to pass `-ldflags '$(DEV_LDFLAGS)'` to `go build`
- `build-release` and CI builds are unaffected (they use `-tags embed_agentrunner`)

## Benefits

- `make release-local && stigmer server` works correctly for local development
- Dev workflow preserved: Python source is resolved live from the repo tree (no rebuild needed for Python-only changes)
- Follows an established codebase pattern (`buildVersion` in `version.go`)
- Zero impact on production builds or CI pipeline

## Impact

- **Developers**: Local development workflow for native agent-runner is now functional
- **CI/Production**: No changes — production builds use `embed_agentrunner` tag
- **Scope**: 2 files changed, 40 insertions, 20 deletions

## Related Work

- Part of project `20260301.02.native-agent-runner` (Docker-to-native migration)
- Follows the pipeline fix in `2026-03-01-230955-post-migration-pipeline-fixes.md`
- Prerequisite for T01.6 (End-to-End Validation)

---

**Status**: Production Ready
