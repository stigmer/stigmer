# Fix Workflow Runner Startup Crash and Eliminate Dual Entry Point

**Date**: May 18, 2026

## Summary

Fixed the workflow-runner `CrashLoopBackOff` caused by a missing `EXECUTION_MODE=temporal` env var in the prod Kustomize overlay, then eliminated the dead root `main.go` entry point so there is a single binary for production and tests. The dispatch logic was also made fail-safe — temporal worker mode is now the default when no workflow file is provided, preventing silent crashes from configuration drift.

## Problem Statement

The workflow-runner pod was crashing on startup in production with:

```
{"level":"fatal","error":"error loading file: read .: is a directory","message":"Unable to load workflow file"}
```

### Pain Points

- The prod Kustomize overlay replaced the base env vars list but omitted `EXECUTION_MODE=temporal`, causing the cobra CLI to fall into the legacy zigflow file-loading path
- Without a `--file` flag or `WORKFLOW_FILE` env var, the file loader tried to read `.` (current directory) as a YAML file, producing a fatal error
- Integration tests never caught this because they built a **different binary** (`main.go` at the repo root) that always enters Temporal worker mode directly — a completely different code path than production
- The test harness didn't set `EXECUTION_MODE=temporal` in its environment either

## Solution

Four-part fix addressing the immediate crash, the unsafe dispatch logic, the dead code, and the test/production divergence:

1. **Prod overlay fix**: Added the missing `EXECUTION_MODE=temporal` env var
2. **Fail-safe dispatch**: Restructured the cobra CLI's `RunE` so zigflow file mode is opt-in (requires explicit `--file`) and temporal worker mode is the safe default
3. **Dead code removal**: Deleted the root `main.go` that was never used by any Dockerfile or build config
4. **Test alignment**: Updated the integration test harness to build `./cmd/zigflow` (same as production Dockerfiles) with `EXECUTION_MODE=temporal`

## Implementation Details

### Dispatch Logic Refactoring (`cmd/worker/root.go`)

Before (unsafe — crashes when `EXECUTION_MODE` is missing):
```go
if executionMode := os.Getenv("EXECUTION_MODE"); executionMode == "temporal" {
    return RunTemporalWorkerMode()
}
// falls through to zigflow file loading — crashes if no file
workflowDefinition, err := zigflow.LoadFromFile(rootOpts.FilePath)
```

After (fail-safe — temporal mode is the default):
```go
if rootOpts.FilePath != "" {
    return runZigflowFileMode()
}
// No file provided: default to Temporal worker
return RunTemporalWorkerMode()
```

The zigflow file-loading code was extracted into `runZigflowFileMode()`, keeping the `RunE` handler clean and the two modes clearly separated.

### Entry Point Consolidation

| Before | After |
|--------|-------|
| `main.go` (root) — direct Temporal worker, used by tests | **Deleted** |
| `cmd/zigflow/main.go` — cobra CLI, used by Dockerfiles | Single entry point for everything |

### Test Harness Changes (`test/integration/harness/workflow_runner.go`)

- Build target: `"."` → `"./cmd/zigflow"`
- Source detection: looks for `cmd/zigflow/main.go` instead of `main.go`
- Environment: added `EXECUTION_MODE=temporal` to match production

## Benefits

- **Immediate**: Unblocks the production deployment — pod will start correctly
- **Structural**: Tests now exercise the exact same binary and code path as production
- **Resilient**: Even if `EXECUTION_MODE` is dropped from a future overlay, the binary defaults to temporal mode with a warning instead of crashing
- **Cleaner**: Removed 108 lines of dead code and the confusion of having two entry points

## Impact

- **Production**: Workflow-runner pod will exit `CrashLoopBackOff` on next deploy
- **Integration tests**: Now build and run the production binary (`cmd/zigflow`) with production-equivalent env vars
- **Developer onboarding**: One entry point to understand, not two

## Related Work

- BusyBox pattern introduction: `d7ce1d3af` (Jan 21, 2026) — added `cmd/zigflow` but left root `main.go` behind
- gRPC removal refactor: `7d3aa5de7` (Feb 7, 2026) — last change to the now-deleted root `main.go`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
