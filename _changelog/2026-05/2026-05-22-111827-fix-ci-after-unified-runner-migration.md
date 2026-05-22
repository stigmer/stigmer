# Fix CI Pipelines After Unified Runner Migration

**Date**: May 22, 2026

## Summary

Fixed four CI pipelines (`release.cli`, `release.desktop`, `ci.docs`, `ci.frontend`) that broke after the unified TypeScript runner migration (PR #151) merged to main. The migration deleted the Python agent-runner and its embedding scripts, but several workflows and a test file still referenced the old infrastructure.

## Problem Statement

After merging PR #151 (feat/unified-runner-migration), which replaced the Python `agent-runner` with a unified TypeScript runner at `backend/services/runner/`, the following pipelines failed on main:

### Pain Points

- `release.cli #609`: Web console build couldn't resolve `@stigmer/protos` (missing `build:libs` step), plus the `lint-and-typecheck-agent-runner` job referenced a deleted directory
- `release.desktop #139`: Same `lint-and-typecheck-agent-runner` job failure against the non-existent `backend/services/agent-runner/` path
- `ci.docs #231`: Documentation site build failed with "Module not found: @stigmer/protos" because SDK libraries weren't compiled before the site build
- `ci.frontend` (latest push): SDK build failed with TypeScript errors in `session-client.test.ts` referencing `threadId` and `sandboxId` fields that were removed from `SessionSpec` proto

## Solution

Systematically removed all stale references to the deleted Python agent-runner infrastructure and ensured SDK library build ordering is correct across all affected workflows.

## Implementation Details

### 1. `sdk/typescript/src/__tests__/gen/session-client.test.ts`
- Removed `threadId` and `sandboxId` from the `SessionInput` test object and assertion blocks
- These fields were removed from the `SessionSpec` proto as part of the unified runner migration

### 2. `.github/workflows/release.desktop.yaml`
- Removed the entire `lint-and-typecheck-agent-runner` job (Python lint/type-check against deleted code)
- Removed "Sync agent-runner source for embedding" and "Sync cursor-runner source for embedding" steps
- Removed `embed_agentrunner embed_cursorrunner` build tags from Go CLI sidecar builds
- Removed "Verify agent-runner source embedded" check
- Updated `build` job `needs` to remove the deleted job dependency

### 3. `.github/workflows/release.cli.yaml`
- Same `lint-and-typecheck-agent-runner` job removal
- Removed sync steps from all three platform build jobs (darwin-arm64, darwin-amd64, linux-amd64)
- Updated build tags from `'embed_agentrunner embed_cursorrunner embed_webconsole'` to `'embed_webconsole'`
- Added `npm run build:libs` step to `build-web-console` job so `@stigmer/protos` is compiled before the web app build

### 4. `.github/workflows/ci.docs.yaml`
- Added `npm run build:libs` step before `make format-docs-check` so SDK packages are compiled before the site references them via `@stigmer/react`

## Benefits

- All main-branch CI pipelines should pass again
- Removed ~130 lines of dead workflow configuration
- Faster CI: eliminated the unnecessary Python lint job from release pipelines (saved ~30s per run)
- Build ordering is now correct: `@stigmer/protos` → `@stigmer/sdk` → `@stigmer/react` → web/docs builds

## Impact

- **All developers**: main branch CI is unblocked, enabling normal development flow
- **Release pipelines**: CLI and Desktop releases can proceed on next tag push
- **Documentation CI**: docs changes will pass CI again

## Related Work

- PR #151: feat(backend/runner) — the unified TypeScript runner migration that triggered these failures
- Commit `13f23a57c`: fix(web) — prior partial fix attempt for Docker proto builds

---

**Status**: ✅ Production Ready
**Timeline**: ~20 minutes (diagnosis + fix)
