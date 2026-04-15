# CLI Release Pipeline: Ship Server and Runner Binaries

**Date**: April 15, 2026

## Summary

Updated the CLI release pipeline to build and ship `stigmer-server` and
`stigmer-workflow-runner` as standalone binaries alongside the CLI. This
completes the decoupling started in the Session 6 SDK refactor, where the
BusyBox embedding pattern was removed and the daemon was changed to launch
separate server/runner processes. Without this pipeline update, local mode was
broken for any fresh install.

## Problem Statement

After the CLI Go SDK refactor (Session 6), the daemon's `findSiblingBinary`
function expects `stigmer-server` and `stigmer-workflow-runner` to exist next
to the CLI binary or on PATH. However, the release pipeline only built and
shipped the `stigmer` CLI binary — the server and runner were never compiled or
included in the tarball.

### Pain Points

- Local mode (`stigmer server start`) failed immediately on fresh installs
  because the server and runner binaries did not exist.
- The CLI build still injected GitHub OAuth client ID/secret via `-ldflags`
  targeting `stigmer-server/pkg/config`, but the CLI no longer imported that
  package after the SDK refactor — the flags were silently dead.
- The `make build` and `make local` targets only produced the CLI binary,
  making local development of the daemon impossible without manually building
  the server and runner.

## Solution

Extended the existing `release.cli.yaml` GitHub Actions workflow to build all
three binaries per platform, package them in a single tarball, and update the
Homebrew formula and local development Makefile targets to match.

## Implementation Details

### Release Pipeline (`release.cli.yaml`)

- **Added two `go build` steps** to each of the three platform jobs
  (`build-darwin-arm64`, `build-darwin-amd64`, `build-linux-amd64`):
  - `stigmer-server` from `backend/services/stigmer-server/cmd/server` with
    OAuth `-ldflags` (moved from the CLI build where they were dead).
  - `stigmer-workflow-runner` from `backend/services/workflow-runner` root
    package (the lean, Stigmer-specific entry point — not the full Zigflow
    Cobra CLI).
- **Cross-compile env vars** (`GOARCH`, `GOOS`) added to the `darwin-amd64`
  server and runner build steps.
- **Removed stale OAuth `-ldflags`** from all three CLI build steps — the CLI
  no longer imports `stigmer-server/pkg/config`.
- **Tarballs** now contain all three binaries instead of just `stigmer`.
- **Verify step** checks all three binaries with `file` and `ls`.

### Homebrew Formula

- `bin.install` now includes `stigmer-server` and `stigmer-workflow-runner`.
- Manual installation instructions updated to `sudo mv` all three binaries.

### Root Makefile

- **`build` target**: builds all three binaries into `bin/`.
- **`local` target**: builds all three, copies to `~/bin/`, cleans up stale
  binaries from previous installs.
- **`clean` target**: now also removes `backend/services/stigmer-server/bin/`.

### Release Documentation

- Stage 2 description updated to explain the three-binary build.
- New "Tarball Contents" table added.
- Best practices, release checklist, and summary updated.

## Benefits

- Local mode works out of the box for fresh installs and Homebrew users.
- OAuth client credentials are injected into the correct binary (the server).
- `make build` and `make local` produce a complete working installation.
- No pipeline structural changes — same trigger logic, same job dependency
  graph, same release flow. Just two additional `go build` calls per platform.

## Impact

- **End users**: `stigmer server start` works immediately after install.
- **Developers**: `make local` produces a complete local development setup.
- **CI**: Slightly larger tarballs and ~30s additional build time per platform.

## Related Work

- [CLI Go SDK Refactor](_changelog/2026-04/2026-04-15-193558-cli-go-sdk-refactor.md) — removed BusyBox pattern, created the need for this pipeline update
- [Generic Apply Handler Framework](_changelog/2026-04/2026-04-15-132852-generic-apply-handler-framework.md) — T01 of CLI modernization
- Project: `_projects/2026-04/20260415.01.cli-modernization`

---

**Status**: Production Ready
**Timeline**: 1 session (~45 min)
