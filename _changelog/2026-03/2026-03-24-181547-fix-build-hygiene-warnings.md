# Fix Build Hygiene Warnings Across Workspace

**Date**: March 24, 2026

## Summary

Resolved all actionable warnings from `make check`: fixed Gazelle merge failure in `seedpack/BUILD.bazel`, synced `MODULE.bazel` `use_repo` declarations, aligned Go dependency versions across 6 workspace modules, added missing replace directives in `test/e2e/go.mod`, and fixed a Vale prose lint warning in `docs/STYLE.md`. The full check suite now passes cleanly.

## Problem Statement

Running `make check` produced several non-fatal warnings that, while not blocking the build, indicated version drift, Bazel configuration staleness, and a prose lint issue.

### Pain Points

- Gazelle emitted `could not merge expression` on `seedpack/BUILD.bazel` every run
- Bazel DEBUG warned about 6 Go modules resolved to higher transitive versions than pinned
- Bazel WARNING listed 10 missing direct deps and 2 stale indirect deps in `use_repo`
- `go mod tidy` failed on `test/e2e` due to missing replace directives for local modules
- Vale flagged "URL" as non-plain-language in `docs/STYLE.md`

## Solution

Systematically fixed each warning category: restructured the BUILD file for Gazelle compatibility, ran `bazel mod tidy`, bumped Go module versions to match transitive resolutions, added missing replace directives, and adjusted wording for Vale compliance.

## Implementation Details

- **`seedpack/BUILD.bazel`**: Replaced `["stigmer.yaml"] + glob([...])` with a `filegroup` target referenced by `embedsrcs`, which Gazelle can merge
- **`MODULE.bazel`**: `bazel mod tidy` added 10 direct deps and removed 2 stale indirect entries
- **Go modules**: Ran `go get` in `apis/stubs/go`, `backend/services/stigmer-server`, `backend/services/workflow-runner`, `client-apps/cli`, `mcp-server`, and `test/e2e` to align grpc (v1.79.2), sqlite (v1.46.0), and AWS SDK versions
- **`test/e2e/go.mod`**: Added `replace` directives for `mcp-server` and `seedpack` (transitive deps via CLI)
- **`docs/STYLE.md`**: Changed "URL" → "Address" in table header

## Benefits

- `make check` runs with zero actionable warnings
- Bazel builds no longer emit version-drift DEBUG messages
- Gazelle can cleanly regenerate `seedpack/BUILD.bazel`
- All Go modules have consistent dependency versions
- Vale passes with 0 errors, 0 warnings across 61 documentation files

## Impact

- **Build system**: Cleaner CI output, reduced noise in developer workflow
- **Dependency management**: All 6 workspace Go modules now pin consistent versions
- **Documentation**: Prose linting is fully clean

## Related Work

- Prior session: `2026-03-24-163837-fix-eslint-errors-and-prettier-formatting.md`

---

**Status**: ✅ Production Ready
