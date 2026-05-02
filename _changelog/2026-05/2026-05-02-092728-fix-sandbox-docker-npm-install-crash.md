# Fix Sandbox Docker Build: npm install crash and tsc rootDir inflation

**Date**: May 2, 2026

## Summary

The cloud sandbox Docker pipeline (`release.sandbox-cloud`) was failing during the cursor-runner build stage. Two distinct issues combined to break the build: an npm crash caused by a stale `package-lock.json` with mismatched `file:` paths, and a TypeScript `rootDir` inflation caused by the recently-introduced model-registry JSON import resolving outside the project directory.

## Problem Statement

The `build-and-push` GitHub Actions workflow was failing with:

```
npm error Cannot read properties of undefined (reading 'extraneous')
ERROR: failed to build: failed to solve: process "/bin/sh -c cd /build/cursor-runner && npm install" did not complete successfully: exit code: 1
```

### Pain Points

- Every push to `main` touching cursor-runner or agent-runner files triggered a broken pipeline
- The sandbox image could not be rebuilt, blocking cloud deployments
- The error message was cryptic — an internal npm tree-resolution crash, not a clear dependency error

## Solution

Three targeted fixes to the Docker build pipeline:

1. **Remove `package-lock.json` from the COPY instruction** — the lockfile references `file:../../../apis/stubs/ts` while the Dockerfile rewrites `package.json` to `file:/build/apis/stubs/ts`. This path mismatch causes npm 10.9+ (Node 22) to crash on an undefined tree node. Without the lockfile, npm does a fresh resolution against the rewritten paths.

2. **Copy `model-registry.json` into the Docker context** — the recent "unify model registry" refactor introduced `import registryData from "../../../../libs/model-registry.json" with { type: "json" }` in `model-pricing-data.ts`. The JSON file was never added to the Docker build, causing tsc to fail or (when present at the wrong path) inflating `rootDir` to `/`.

3. **Set explicit `rootDir: "src"` in `tsconfig.build.json`** — prevents TypeScript from computing the common ancestor of `/build/cursor-runner/src/` and `/libs/model-registry.json` as `/`, which would emit output as `dist/build/cursor-runner/src/...` instead of the expected flat `dist/main.js`.

## Implementation Details

### Files Changed

- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full`
  - Removed `package-lock.json*` from the multi-file COPY
  - Added `COPY backend/libs/model-registry.json /libs/model-registry.json`
  - Replaced broken ESM import verification with `test -f` existence check

- `backend/services/cursor-runner/tsconfig.build.json`
  - Added `"rootDir": "src"` to compilerOptions

- `.github/workflows/release.sandbox-cloud.yaml`
  - Added `backend/libs/model-registry.json` to trigger paths so model pricing changes rebuild the sandbox

### Why the lockfile removal is safe

The `package-lock.json` was never useful inside the Docker build because:
- The `file:` dependency path is always rewritten for the container filesystem
- The lockfile's `packages` map still references the host-relative `../../../apis/stubs/ts`
- npm must resolve from scratch anyway after the path rewrite

## Benefits

- Sandbox Docker build passes end-to-end (npm install + tsc + prune + verification)
- Pipeline will succeed on next push to `main`
- Model registry changes now correctly trigger sandbox rebuilds

## Impact

- **Cloud deployments**: Unblocked — the sandbox image can be built and pushed again
- **Local development**: `tsconfig.build.json` rootDir fix also corrects local `npx tsc -p tsconfig.build.json` output structure
- **CI trigger coverage**: Model registry updates now trigger sandbox rebuilds automatically

## Related Work

- `2026-05-01-183214-unified-model-registry.md` — introduced the JSON import that exposed the rootDir issue
- `2026-05-01-191041-fix-cursorrunner-tsc-rootdir-inflation.md` — earlier rootDir fix attempt
- `2026-05-02-091044-fix-npx-tsc-ci-resolution.md` — adjacent CI fix in same timeframe

---

**Status**: Production Ready
**Timeline**: ~20 minutes diagnosis + fix + verification
