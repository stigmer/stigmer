# Cursor Harness Gap Assessment — Five Fixes

**Date**: April 30, 2026

## Summary

Closed five implementation gaps identified in a structured assessment of the cursor-harness feature branch. Changes span harness immutability enforcement (Go + Java), npm publishing readiness for `@stigmer/cursor-runner`, sandbox image expansion with Node.js 22 and the cursor-runner, dual-worker startup wiring, and `make check` CI coverage.

## Problem Statement

The cursor-harness feature (T01–T09) was functionally complete but had five gaps surfaced during review:

### Pain Points

- **Harness immutability** was documented in proto comments and the T01 plan but not enforced server-side — the API accepted harness changes on sessions that had already executed, which would silently break conversation continuity
- **No npm publish path** for `@stigmer/cursor-runner` — the Python agent-runner publishes to PyPI, but cursor-runner was marked `"private": true` with a non-portable `file:` proto dependency
- **Sandbox image excluded cursor-runner** — `Dockerfile.sandbox.full` only baked in the Python agent-runner, meaning cloud-mode Cursor harness executions had no worker binary available
- **Sandbox Node.js was too old** — Debian bookworm ships Node.js 18; the Cursor SDK requires >= 20
- **cursor-runner not in `make check`** — typecheck, lint, and test were not run during local CI gate

## Solution

Addressed all five in a single pass, ordered to unblock downstream work:

1. Server-side harness immutability guard in both backends
2. npm publishing infrastructure for cursor-runner
3. Multi-stage Docker build adding cursor-runner to the sandbox
4. Dual-worker startup command for Daytona sandboxes
5. Makefile targets for cursor-runner in the CI gate

## Implementation Details

### 1. Harness Immutability (Go + Java)

**Go OSS** — New pipeline step `ValidateHarnessImmutabilityStep` in `backend/services/stigmer-server/pkg/domain/session/controller/`. Runs after `LoadExisting`, before `BuildUpdateState`. Checks `thread_id != ""` on the existing session; if the input harness differs (treating `UNSPECIFIED` as `NATIVE`), returns `FAILED_PRECONDITION`.

**Java Cloud** — Inner `@Component` class `ValidateHarnessImmutabilityStep` in `SessionUpdateHandler`. Same logic. The `SessionApplyHandler` inherits the guard since it delegates updates to `SessionUpdateHandler`.

### 2. NPM Publishing

- Removed `"private": true` from `cursor-runner/package.json`
- Added `publishConfig` (`access: "public"`, `main`, `types`, `exports` into `dist/`)
- Added `bin.stigmer-cursor-runner` for global CLI install
- Added `files`, `keywords`, `repository` metadata
- Changed `"build"` script to `tsc -p tsconfig.build.json` (emits to `dist/`)
- Added `#!/usr/bin/env node` shebang to `src/main.ts`
- Created `.github/workflows/release.cursor-runner.yaml`: generates TS proto stubs, builds, rewrites `file:` dep to semver version, publishes `dist/` to npm on `v*` tag

Chose a dedicated workflow over adding to `publish-libs.mjs` because the cursor-runner has different needs (native Temporal deps, bin entry, proto stub generation) vs the SDK library packages.

### 3. Sandbox Image

- Added `cursor-runner-builder` stage in `Dockerfile.sandbox.full` using `node:22-slim` — installs deps, compiles TS, prunes dev deps, verifies the build
- Replaced Debian's `nodejs`/`npm` packages with Node.js 22 LTS via multi-stage `COPY` from `node:22-slim` — deterministic version, no external apt sources
- Compiled cursor-runner copied to `/cursor-runner/` in the final image with production `node_modules`
- Added cursor-runner path triggers to `release.sandbox-cloud.yaml`

### 4. Dual-Worker Startup

Updated `runner-start-command` in `application-runner-launcher.yaml` to start both workers:
```
nohup /app/.venv/bin/python /app/main.py > /var/log/runner.log 2>&1 & nohup node /cursor-runner/dist/main.js > /var/log/cursor-runner.log 2>&1 &
```

Both workers share the same Temporal task queue; Temporal routes activities by type (`ExecuteGraphton` vs `ExecuteCursor`). `WORKSPACE_ROOT_DIR=/workspace` was already injected by `DaytonaSandboxRunnerLauncher.buildEnvVars()`.

### 5. Make Check Coverage

Added `CURSOR_RUNNER_DIR := backend/services/cursor-runner` to the Makefile and wired it into:
- `setup` — `npm install`
- `lint` — `npm run typecheck`
- `test` — `npm test` (vitest)

## Benefits

- **API contract integrity** — Harness immutability is now enforced at the only reliable layer (server-side), preventing silent conversation history loss
- **Publishing parity** — Both runners (Python and TypeScript) have first-class publish workflows to their respective registries
- **Cloud readiness** — Sandbox image now supports both harnesses out of the box, eliminating a blocker for cloud E2E testing
- **CI safety net** — cursor-runner type errors will be caught by `make check` before they reach CI

## Impact

- **OSS stigmer-server**: Session update/apply API now returns `FAILED_PRECONDITION` if harness change is attempted after first execution
- **Cloud stigmer-service**: Same enforcement via `SessionUpdateHandler` pipeline
- **Sandbox image**: Size increases (~150MB for Node.js 22 + cursor-runner deps), but Node.js was already present (Debian's v18) for MCP runtimes
- **CI**: `make check` runs ~5s longer (cursor-runner typecheck + vitest)

## Related Work

- [Cursor Runner TypeScript Service](_changelog/2026-04/2026-04-30-144627-cursor-runner-typescript-service.md) — the T03 implementation this assessment builds on
- [Runner Platform Builder Integration Guide](_changelog/2026-04/2026-04-28-142854-runner-platform-builder-integration-guide.md) — documents the CLI sidecar pattern that applies to both runners

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes)
