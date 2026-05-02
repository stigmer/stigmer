# Fix `npx tsc` Resolving to Wrong Package in CI

**Date**: May 2, 2026

## Summary

Fixed a CI build failure where `npx tsc` installed the unrelated `tsc@0.0.4` npm stub package instead of invoking the TypeScript compiler. The fix adds `typescript` as an explicit devDependency in the two locations where it was missing, restoring the `build-darwin-arm64` (and other platform) CI jobs.

## Problem Statement

The "Sync cursor-runner source for embedding" step in the CLI release workflow failed on all platform builds (`build-darwin-arm64`, `build-darwin-amd64`, `build-linux-amd64`).

### Pain Points

- `npx tsc` in the proto stubs directory resolved to `tsc@0.0.4` — a completely different npm package that prints "This is not the tsc command you are looking for" and exits 1
- The proto stubs `package.json` declared a `build` script using `tsc` but never listed `typescript` as a dependency
- `sync.sh` deleted all `devDependencies` from the cursor-runner package copy, removing `typescript` before compilation
- Both `npx tsc` calls in `sync.sh` (proto stubs at Step 2b, cursor-runner at Step 5) were affected

## Solution

Made `typescript` explicitly available in both compilation contexts within `sync.sh`:

1. Added `typescript` as a `devDependency` to the proto stubs package
2. Changed `sync.sh` to selectively retain `typescript` instead of blanket-deleting all devDependencies

## Implementation Details

**`apis/stubs/ts/package.json`** — Added `devDependencies` with `typescript: "^5.7.0"`. This is the correct declaration regardless of the CI fix since the package's own `build` script calls `tsc`.

**`client-apps/cli/embedded/cursorrunner/sync.sh`** — Changed Step 3 from `delete pkg.devDependencies` to `pkg.devDependencies = { typescript: pkg.devDependencies?.typescript || '^5.7.0' }`, which keeps only what's needed for compilation while still stripping `tsx`, `vitest`, and other dev-only tools.

## Benefits

- Unblocks all CLI and desktop release builds
- Makes the `typescript` dependency explicit and correct in the proto stubs package
- No additional CI minutes — `typescript` was already being installed transitively in working builds; now it's declared properly

## Impact

Affects the CLI release pipeline (`release.cli.yaml`) across all three platform jobs and the desktop release pipeline (`release.desktop.yaml`). No runtime behavior changes — this is purely a build-time dependency fix.

## Related Work

- CI workflow: `.github/workflows/release.cli.yaml`
- Embed sync script: `client-apps/cli/embedded/cursorrunner/sync.sh`
- Proto stubs package: `apis/stubs/ts/package.json`

---

**Status**: ✅ Production Ready
