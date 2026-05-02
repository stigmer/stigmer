# Fix Sandbox Docker Build: model-registry.json Path Mismatch

**Date**: May 2, 2026

## Summary

Fixed the sandbox Docker build (`Dockerfile.sandbox.full`) which failed with `TS2307: Cannot find module '../../data/model-registry.json'` during the cursor-runner TypeScript compilation stage. The `COPY` instruction was still targeting the old `/libs/` location after the import path was refactored to `../../data/` in commit `993bf19a0`.

## Problem Statement

The CI pipeline `build-and-push` job failed at the "Build and push full sandbox image" step with a TypeScript compilation error.

### Pain Points

- Commit `993bf19a0` ("unify model-registry.json distribution across all consumers") changed `model-pricing-data.ts` to import from `../../data/model-registry.json` instead of `../../../../libs/model-registry.json`
- The Dockerfile was not updated to match — it still copied `backend/libs/model-registry.json` to `/libs/model-registry.json`
- Inside Docker, `tsc` runs from `/build/cursor-runner/`, so `../../data/model-registry.json` resolves to `/build/cursor-runner/data/model-registry.json` which did not exist

## Solution

Updated the `COPY` instruction in `Dockerfile.sandbox.full` to place the model registry JSON at the path the TypeScript import resolves to inside the Docker build context.

## Implementation Details

Single-line change in `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full`:

```dockerfile
# Before
COPY backend/libs/model-registry.json /libs/model-registry.json

# After
COPY backend/services/cursor-runner/data/model-registry.json /build/cursor-runner/data/model-registry.json
```

Uses the synced copy from `cursor-runner/data/` (identical to canonical `backend/libs/model-registry.json`) rather than the canonical source directly, consistent with the design intent of `993bf19a0` where each consumer carries the JSON in its own `data/` directory.

## Benefits

- Unblocks the CI pipeline for sandbox image builds
- Aligns the Docker build with the local development build (both resolve the same `../../data/` relative path)

## Impact

- **CI/CD**: Restores the `build-and-push` pipeline to a passing state
- **Scope**: Single file change in the sandbox Dockerfile; no runtime behavior change

## Related Work

- `2026-05-02-112631-unify-model-registry-distribution.md` — the refactoring commit that introduced this regression
- `2026-05-02-092728-fix-sandbox-docker-npm-install-crash.md` — earlier sandbox Docker fix in the same build pipeline

---

**Status**: Production Ready
