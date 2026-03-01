# Post-Migration Pipeline and Build Fixes

**Date**: March 1, 2026

## Summary

After migrating agent-runner from Docker to native OS process, the CI release pipeline and Makefile were never updated. The release pipeline had a release-blocking bug: CLI binaries shipped without embedded agent-runner source, meaning `stigmer server` would fail for every end user. This session identified 8 gaps across CI, Makefile, and documentation, then fixed all of them.

## Problem Statement

The native-agent-runner migration (T01.0-T01.5, WA-01) rewrote the daemon, removed Docker agent-runner code, and introduced a new build mechanism (`sync.sh` + `//go:embed`). However, the release infrastructure was never updated to match.

### Pain Points

- **Release-blocking**: CI pipeline built CLI without `-tags embed_agentrunner` and without running `sync.sh`, so production binaries had no agent-runner source embedded
- **Dead CI job**: `build-agent-runner-image` still built and pushed a Docker image to ghcr.io that nothing consumed
- **Broken Makefile**: `release-local` target was entirely Docker-based (`docker build`, `docker stop`, `docker rm`) and failed immediately
- **Stale documentation**: Release workflow docs referenced PyInstaller, Docker requirements, and standalone agent-runner binaries
- **Silent bug**: `sync.sh` had a wrong path for graphton (`libs/python/graphton` instead of `backend/libs/python/graphton`), silently skipping the library copy

## Solution

Surgically updated the four affected files to align with the native agent-runner architecture. No new abstractions or over-engineering — just correcting the build pipeline to use the mechanisms already in place.

## Implementation Details

### CI Pipeline (`release.cli.yaml`)

- Removed the entire `build-agent-runner-image` job (Docker image build/push)
- Added `sync.sh` step to all three platform build jobs (darwin-arm64, darwin-amd64, linux-amd64)
- Added `-tags embed_agentrunner` to `go build` commands so Python source is embedded via `//go:embed`
- Added `lint-and-typecheck-agent-runner` as a dependency for all platform builds (was previously only gating the dead Docker job)
- Removed `build-agent-runner-image` from the `release` job's `needs`
- Cleaned Docker references from changelog templates

### Makefile

- Removed `AGENT_RUNNER_SENTINEL` variable (dead Docker cache sentinel)
- Rewrote `release-local`: simple dev-mode `go build` + install (agent-runner source auto-located from repo tree)
- Added `build-release` target: runs `sync.sh` + builds with `-tags embed_agentrunner` for local production-like testing
- Updated `clean` to remove synced `source/` directory instead of dead sentinel

### Documentation (`release-workflow.md`)

- Replaced PyInstaller references with `sync.sh` + `//go:embed` description
- Updated Stage 2 build process to reflect actual steps
- Updated local testing instructions to use `make build-release`
- Replaced PyInstaller troubleshooting with agent-runner sync troubleshooting
- Removed standalone agent-runner binary references from release assets

### `sync.sh`

- Fixed graphton path: `$REPO_ROOT/libs/python/graphton` -> `$REPO_ROOT/backend/libs/python/graphton`

## Benefits

- **Release pipeline actually works**: CLI binaries will now contain embedded agent-runner source
- **No wasted CI minutes**: Removed dead Docker image build that consumed multi-arch build time
- **Local dev works**: `make release-local` builds and installs correctly without Docker
- **Production testing**: `make build-release` lets developers verify the embedded build locally
- **Graphton included**: `sync.sh` now correctly copies the graphton library into the embed directory

## Impact

- **Files changed**: 4
- **Lines**: 54 insertions, 121 deletions (net -67 lines)
- **Components**: CI pipeline, Makefile, release documentation, embed sync script
- **Risk**: Low — changes are to build infrastructure, not runtime code

## Related Work

- `2026-03-01-194354-consolidate-lifecycle-management-single-daemon.md` — The WA-01 resolution that removed all Docker agent-runner code
- `2026-03-01-183330-native-agent-runner-process-mode.md` — T01.4 that introduced native agent-runner startup
- `2026-03-01-174505-python-runtime-manager.md` — T01.2 that implemented the Python runtime manager

---

**Status**: Production Ready
**Timeline**: Single session
