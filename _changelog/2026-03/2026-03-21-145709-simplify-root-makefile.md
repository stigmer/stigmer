# Simplify Root Makefile and Remove Stale E2E Tests

**Date**: March 21, 2026

## Summary

Simplified the root Makefile from 18 user-facing targets down to 13, removed ~22,000 lines of stale end-to-end tests, and added a `make site` target for launching the documentation website with hot reload.

## Problem Statement

The root Makefile had accumulated targets that were never used, redundant with CI, or supporting stale infrastructure. The `test/e2e/` directory (~170 files, ~22k lines) had not been maintained and was no longer part of the active development workflow.

### Pain Points

- `make help` listed targets like `sandbox`, `sandbox-clean`, `build-release`, and `protos-release` that were never used in practice
- `protos-release` and `release` were separate targets that should have been a single workflow
- `update-agent-runner-deps` was unnecessarily verbose as a target name
- No way to launch the documentation website from the repository root
- `test/e2e/` was dead code referenced by `go.work` and the Makefile, adding confusion

## Solution

Audited every Makefile target against actual usage, removed unused ones, merged redundant ones, and added a missing convenience target for the docs site.

## Implementation Details

**Removed targets**: `test-e2e`, `build-release`, `protos-release`, `sandbox`, `sandbox-clean`

**Merged `protos-release` into `release`**: The `release` target now runs `$(MAKE) -C apis release` (buf push) first with a `-` prefix so errors from "no changes" do not abort the release. This eliminates the need for a separate `protos-release` target.

**Renamed**: `update-agent-runner-deps` to `update-deps` for brevity.

**Demoted to internal**: `libs-build`, `web-build`, and `web-console-build` no longer appear in `make help` (removed `##` comments) but remain as targets called by `check` and `local`.

**New target**: `make site` delegates to `site/Makefile`'s `dev` target, which handles `yarn install` and starts the Next.js dev server with hot reload.

**Deleted**: Entire `test/e2e/` directory (142 files, ~22k lines). Removed the `./test/e2e` entry from `go.work`.

**Removed variable**: `sandbox ?= basic` at the top of the Makefile (only used by the deleted `sandbox` target).

## Benefits

- `make help` output is clean and shows only targets that are actually used
- Single `make release` command handles both proto publishing and Git tag release
- `make site` enables quick iteration on docs without navigating to `site/`
- ~22k lines of dead test code removed, reducing cognitive overhead and `go.work` complexity

## Impact

- **Developers**: Cleaner `make help`, new `make site` convenience target
- **CI**: No impact (CI workflows were not using the removed targets)
- **go.work**: One fewer module entry, which slightly speeds up Go workspace operations

## Related Work

- Documentation website (`site/`) setup and Fumadocs migration
- Documentation standards infrastructure (`docs/standards/`)

---

**Status**: ✅ Production Ready
