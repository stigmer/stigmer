# Fix Native Agent Runner PYTHONPATH and Clean Up Stale Build Artifacts

**Date**: April 28, 2026

## Summary

Fixed the `ModuleNotFoundError: No module named 'stigmer_runner'` crash that prevented the agent runner from starting in native/CLI mode. The root cause was a missing `PYTHONPATH` environment variable in the Go CLI's runner environment builders — a gap introduced when the agent-runner was restructured to the `src/stigmer_runner/` layout for PyPI publishing. Also cleaned up stale PyInstaller references and fixed a missing file in the Bazel BUILD.

## Problem Statement

After the PyPI restructuring (commit `e632cb13a`), the agent-runner package moved from a flat layout to a proper `src/stigmer_runner/` directory structure. The Docker path was updated with `PYTHONPATH="/app/src"`, but the Go native bootstrap path — used by `stigmer up runner` and the embedded daemon — was not. This caused every native runner start to crash immediately after bootstrapping.

### Pain Points

- Runner starts, registers with backend, bootstraps Python, then crashes on first import
- Error is opaque to users: `ModuleNotFoundError: No module named 'stigmer_runner'`
- Requires manual workaround (`PYTHONPATH` export or runtime directory deletion)
- Docker and native paths diverged silently — no CI gate catches this class of error

## Solution

Set `PYTHONPATH=<appDir>/src` in both Go runner environment builders so the Python interpreter can resolve the `stigmer_runner` package from the `src/` layout. This mirrors what the Dockerfile already does.

## Implementation Details

### PYTHONPATH in runner environment builders

Two independent code paths construct the runner's environment:

1. **`BuildRunnerEnv()`** in `client-apps/cli/internal/cli/runner/runner_env.go` — used by `stigmer up runner` (foreground mode). The `EnvParams.AppDir` field was already populated by the caller; the fix adds `PYTHONPATH` derivation from it.

2. **`buildRunnerEnv()`** in `client-apps/cli/internal/cli/daemon/daemon_process.go` — used by the embedded daemon. Required adding `appDir` as a new parameter (it was already available in the closure scope but not passed through).

### Stale PyInstaller Makefile

The service-local `backend/services/agent-runner/Makefile` contained four dead targets (`build-binary`, `clean-binary`, `test-binary`, `rebuild-binary`) referencing a non-existent `agent-runner.spec` file, plus help text pointing to a non-existent root Makefile target. Replaced with a minimal file that documents the current packaging approach (`pythonrt`) and provides a `clean` target.

### Bazel BUILD completeness

`client-apps/cli/embedded/agentrunner/BUILD.bazel` was missing `agentrunner_embed.go` from its `srcs` list. Added it — Go build tags ensure it only compiles when `embed_agentrunner` is active.

### Rule documentation

Added a troubleshooting entry for the `stigmer_runner` import error to the agent-runner implementation rules, documenting the `PYTHONPATH` mechanism and re-bootstrap procedure.

## Benefits

- Native runner starts successfully after the PyPI restructuring
- Docker and native paths now use the same `PYTHONPATH` strategy — consistent behavior
- Dead build targets removed — less confusion for contributors
- Bazel BUILD file now lists all source files — correct for production embed builds

## Impact

- **Users**: Anyone running `stigmer up runner` or the desktop app's embedded runner can now start the agent runner without manual workarounds
- **CI**: Bazel builds with `embed_agentrunner` tag will no longer silently omit the embed file
- **Contributors**: Service Makefile no longer references non-existent tooling

## Related Work

- `e632cb13a feat(agent-runner): publish as stigmer-runner PyPI package` — the restructuring that introduced the gap
- `13c9ac78f fix(agent-runner): add PYTHONPATH so stigmer_runner is importable in Docker images` — Docker-side fix (already landed)

---

**Status**: Production Ready
