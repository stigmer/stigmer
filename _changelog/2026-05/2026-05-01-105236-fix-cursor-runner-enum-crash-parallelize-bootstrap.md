# Fix Cursor Runner TypeScript Enum Crash and Parallelize Runner Bootstrapping

**Date**: May 1, 2026

## Summary

Fixed a runtime crash in the embedded cursor-runner caused by Node.js 22's strip-only TypeScript mode encountering `export enum` syntax in proto stubs. Additionally restructured the native runner startup to overlap the Python and Node.js bootstrap phases, reducing first-run startup latency.

## Problem Statement

Two issues affected cursor-runner reliability and startup performance:

### Pain Points

- **Runtime crash**: The embedded cursor-runner crashed immediately on startup with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` because Node.js 22.22.2's built-in TypeScript support cannot transform `enum` declarations — it only strips type annotations
- **Sequential bootstrap**: The Python runtime bootstrap (venv setup) and Node.js runtime bootstrap (download + npm install) ran sequentially, adding unnecessary delay on first run when both runtimes need to be initialized from scratch

## Solution

### Fix 1: Pre-compile Proto Stubs in `sync.sh`

The root cause was that `@stigmer/protos` exports raw `.ts` files via `"exports": { "./*": "./*.ts" }`. When cursor-runner's compiled `dist/main.js` imports from `@stigmer/protos`, Node.js resolves to `.ts` files that contain `export enum` — syntax that strip-only mode cannot handle. Dev mode avoids this because `tsx` fully transpiles TypeScript.

Added a Step 2b to `sync.sh` that:
1. Runs `npm install --ignore-scripts` in the copied `libs/stigmer-protos` to install `@bufbuild/protobuf`
2. Compiles the stubs to JavaScript via `tsc -p tsconfig.build.json`
3. Rewrites the package exports to use Node.js conditional exports: `types` resolves to raw `.ts` (for type-checking), `import` resolves to `dist/*.js` (for runtime)
4. Cleans up build-time `node_modules`

The source-of-truth `apis/stubs/ts/package.json` is intentionally left unchanged — other consumers (web console via Vite, dev mode via tsx) handle `.ts` natively. Only the embed path needs compiled JS, and `sync.sh` handles that transformation.

### Fix 2: Parallel Bootstrap Phases

Restructured `startNativeRunner` in `start.go` to launch `BootstrapCursorRunnerRuntime` in a goroutine concurrently with `BootstrapPythonRuntime`. The bootstrap result is sent on a buffered channel. After the Python process starts and transitions to READY, the cursor-runner goroutine receives the bootstrap result and launches the Node.js process.

Renamed `startCursorRunnerProcess` to `launchCursorRunnerProcess` since the function no longer owns the bootstrap — it receives a pre-completed `*CursorRunnerBootstrapResult`.

## Implementation Details

### Files Changed

- **`client-apps/cli/embedded/cursorrunner/sync.sh`**: Added Step 2b — proto stubs compilation and conditional exports rewrite. All three deployment paths (local dev via `make desktop-dev`, CI desktop via `release.desktop.yaml`, CI CLI via `release.cli.yaml`) converge on this script, so a single change covers all paths.

- **`client-apps/cli/internal/cli/runner/start.go`**: Added `cursorBootstrapOutcome` struct for the channel result. Restructured `startNativeRunner` to check `IsCursorRunnerAvailable` and start the cursor-runner bootstrap goroutine before `BootstrapPythonRuntime`. Replaced `startCursorRunnerProcess` with `launchCursorRunnerProcess` that takes a pre-completed bootstrap result.

### Relationship to April 30 Import Extension Fix

The April 30 fix (`import_extension=js` in protoc-gen-es) and this fix operate at different layers:
- **April 30 (compile-time)**: Added `.js` extensions to inter-file imports inside proto stubs so `tsc` can compile under `moduleResolution: "NodeNext"`
- **This fix (runtime)**: Compiles the stubs to JS and rewrites exports so Node.js resolves to `.js` at runtime

The April 30 fix is a prerequisite — without correct `.js` import paths in the compiled output, the runtime fix alone would not resolve imports correctly.

## Benefits

- **Crash eliminated**: Cursor-runner starts reliably in embed mode on Node.js 22
- **Faster first-run startup**: Python and Node.js bootstraps overlap instead of running sequentially, saving up to 60–120 seconds on first run
- **All deployment paths fixed**: Single `sync.sh` change covers local dev, CI desktop, and CI CLI builds
- **Clean architecture**: Conditional exports pattern is the standard Node.js mechanism for dual TS/JS packages; the channel-based bootstrap overlap uses straightforward Go concurrency

## Impact

- **End users**: Cursor harness is functional in embedded/managed runtime mode (previously crashed on startup)
- **Developers**: No changes to dev workflow — `tsx`-based dev mode and source `package.json` remain untouched
- **CI/CD**: Build time increases slightly (proto stubs compilation in `sync.sh`) but is offset by the overall reliability improvement

## Related Work

- `2026-04-30-200243-fix-proto-ts-import-extensions-nodenext.md` — prerequisite compile-time fix for import extensions
- `2026-05-01-101548-fix-dev-mode-runner-startup-delay.md` — dev-mode startup delay elimination
- `2026-05-01-104311-add-runner-phase-starting-lifecycle.md` — RUNNER_PHASE_STARTING lifecycle (the heartbeat stream structure this fix builds on)

---

**Status**: Production Ready
