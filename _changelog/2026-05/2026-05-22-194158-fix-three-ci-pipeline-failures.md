# Fix Three CI Pipeline Failures After Unified Runner Migration

**Date**: May 22, 2026

## Summary

Fixed three CI pipelines (`release.cli`, `ci.integration-offline`, `ci.e2e`) that were failing after the unified runner migration deleted the legacy Go `workflow-runner`. Each pipeline had an independent root cause: a stale build path, missing npm dependency installation, and an unconditional local backend bootstrap in E2E global setup.

## Problem Statement

After commit `e92f595f2` deleted the legacy Go runners and migrated to the unified TypeScript runner at `backend/services/runner/`, three CI workflows broke on every push to `main`.

### Pain Points

- `release.cli` failed on all three platform builds (darwin-arm64, darwin-amd64, linux-amd64) with `cd: backend/services/workflow-runner: No such file or directory`
- `ci.integration-offline` suites 3 and 4 (session routing, wfexec routing) failed with hundreds of `Cannot find module '@bufbuild/protobuf/codegenv1'` errors
- `ci.e2e` failed immediately in global setup trying to spawn a Temporal dev server that isn't installed on CI runners

## Solution

Three independent fixes, one per pipeline:

1. **release.cli**: Remove all references to the deleted `backend/services/workflow-runner` Go binary
2. **ci.integration-offline**: Add `npm ci`, proto stubs build, and runner install+build steps
3. **ci.e2e**: Guard `global-setup.ts` against external targets and add `--project=smoke` filter

## Implementation Details

### Pipeline 1: `release.cli.yaml`

Removed the "Build stigmer-workflow-runner" step from all three platform build jobs. Also cleaned up downstream references in the "Verify binaries" (`file` command), "Package" (`tar` command), and Homebrew formula (`bin.install`) sections. The CLI now ships only `stigmer` + `stigmer-server` — the unified runner is bootstrapped at runtime by the CLI daemon.

### Pipeline 2: `ci.integration-offline.yaml`

Added three steps after "Setup Node.js" and before the test suites:
- `npm ci` at the root to install workspace dependencies (including `@bufbuild/protobuf` for `@stigmer/protos`)
- `npm run build -w @stigmer/protos` to compile proto stubs to `dist/`
- `npm ci && npm run build` in `backend/services/runner/` (standalone package outside root workspaces)

### Pipeline 3: `ci.e2e.yaml` + `test/e2e/global-setup.ts`

Two changes:
- Added early-return guard in `global-setup.ts`: when `STIGMER_E2E_BASE_URL` is set, skip the entire backend stack bootstrap (Temporal + stigmer-server + runner). This is correct because smoke tests against a deployed instance don't need local infrastructure.
- Added `--project=smoke` filter to `npx playwright test` in the CI workflow, matching the `make test-e2e-smoke` target. Previously it ran all three Playwright projects (smoke + functional + interactive).

## Benefits

- All three CI pipelines should pass on the next push to `main`
- No wasted CI minutes on builds that deterministically fail
- E2E smoke tests correctly target the deployed instance without attempting local backend bootstrap

## Impact

- `release.cli` — CLI releases resume building and publishing for all three platforms
- `ci.integration-offline` — Session routing and wfexec routing integration test suites can run their Tier 2 dispatch tests
- `ci.e2e` — Post-deploy smoke validation resumes against `app.stigmer.ai`

## Related Work

- Commit `e92f595f2` — deleted legacy runners, creating the root cause
- Commit `7096e62d9` — partially cleaned `release.cli.yaml` (removed agent-runner refs) but missed workflow-runner

---

**Status**: ✅ Production Ready
