# Fix workflow-runner CI Build Path After Entry Point Migration

**Date**: May 18, 2026

## Summary

Fixed the `release.cli` pipeline failure caused by a stale `go build .` target in the CI workflow and Makefile `local` target. After the root `main.go` was removed in favor of `cmd/zigflow/main.go`, three platform build jobs and the local dev build broke with "no Go files" errors.

## Problem Statement

Commit `5b90d74a6` ("fix startup crash and eliminate dual entry point") deleted `backend/services/workflow-runner/main.go`, consolidating the entry point into `cmd/zigflow/main.go`. However, the CI workflow and the Makefile `local` target were not updated and still ran `go build ... .` from the module root.

### Pain Points

- All three platform builds (darwin-arm64, darwin-amd64, linux-amd64) failed with `no Go files in .../backend/services/workflow-runner`
- The `release.cli` pipeline was completely blocked — no CLI releases could ship
- The `make local` target was also broken for local development

## Solution

Updated the build path from `.` to `./cmd/zigflow` in all affected locations, aligning them with the root Makefile `build` target and the Dockerfile, which already used the correct path.

## Implementation Details

- **`.github/workflows/release.cli.yaml`**: Changed the `go build` target from `.` to `./cmd/zigflow` in all three platform build steps (darwin-arm64, darwin-amd64, linux-amd64)
- **`Makefile`**: Changed the `local` target's workflow-runner build from `.` to `./cmd/zigflow`, matching the existing `build` target

## Benefits

- Unblocks the `release.cli` pipeline for all platforms
- Restores `make local` for local development workflows
- All four build paths (CI x3 + Makefile `build` + Makefile `local` + Dockerfile) now consistently use `./cmd/zigflow`

## Impact

- **CI**: `release.cli` pipeline will pass the workflow-runner build step on all platforms
- **Developers**: `make local` works again for local development

---

**Status**: ✅ Production Ready
