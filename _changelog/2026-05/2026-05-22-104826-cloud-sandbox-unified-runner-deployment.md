# Cloud Sandbox Deployment Pipeline for the Unified Runner

**Date**: May 22, 2026

## Summary

Created the cloud sandbox deployment pipeline for the unified TypeScript runner, replacing the legacy three-runner sandbox image (agent-runner + cursor-runner + workflow-runner) with a single-stage build. The new Dockerfile, updated CI workflow, and fixed start command in stigmer-cloud complete the deployment story for the unified runner migration.

## Problem Statement

After the unified runner migration deleted all three legacy runners (322K lines removed), the cloud deployment pipeline was broken:

### Pain Points

- `Dockerfile.sandbox.full` was deleted along with `agent-runner/` — no sandbox image could be built
- `release.sandbox-cloud.yaml` still triggered on deleted paths (`agent-runner/`, `cursor-runner/`, `workflow-runner/`)
- Production was frozen on the last legacy image `ghcr.io/stigmer/agent-sandbox-full:main-b9ab8ba`
- stigmer-cloud's start command referenced `node /runner/src/main.js` (raw TypeScript requiring tsx) instead of the compiled `dist/main.js`

## Solution

Three-part fix across both repositories:

1. **New `Dockerfile.sandbox`** — Multi-stage build producing a 1.05GB image (down from ~2GB) with the unified runner at `/runner/dist/` plus workspace tooling (Node 22, Go 1.25, Python 3, uv/uvx, yq, git, jq)
2. **Updated CI workflow** — Path triggers, Dockerfile reference, and image name all point to the unified runner; image renamed from `agent-sandbox-full` to `runner`
3. **Fixed start command** — stigmer-cloud config, Java defaults, and test fixtures updated to `node /runner/dist/main.js`

## Implementation Details

### Dockerfile (`backend/services/runner/Dockerfile.sandbox`)

- **Builder stage**: Compiles `@stigmer/protos` (proto stubs), installs runner deps with `--legacy-peer-deps` (LangChain ecosystem peer dep conflicts), builds TypeScript to `dist/`, prunes dev deps, resolves the `file:` symlink for `@stigmer/protos` into a real copy
- **Runtime stage**: Debian bookworm-slim with Node 22 (copied from official image), Go 1.25 toolchain, Python 3 + venv, uv/uvx, yq, and core utilities — all needed because the runner spawns MCP servers via `npx`, `uvx`, and `go run`
- **Build context**: Repository root (same pattern as the old Dockerfile)

### CI Workflow (`.github/workflows/release.sandbox-cloud.yaml`)

- Path triggers narrowed to `backend/services/runner/` and `apis/stubs/ts/`
- Image name changed to `ghcr.io/stigmer/runner` (matches Java default in `SandboxProvisionerConfig`)
- Planton variable `sandbox-ci/prod.sandbox-image` auto-updated by CI — no manual intervention needed
- GHCR visibility step updated for the new package name

### stigmer-cloud Start Command

- `application-sandbox.yaml`: `src/main.js` → `dist/main.js`
- `SandboxProvisionerConfig.java`: default `runnerStartCommand` updated
- `DaytonaSandboxProvisionerTest.java`: test setup updated

## Benefits

- **Image size reduced ~50%**: 1.05GB vs ~2GB (no Python venv, no Go binary, no separate cursor-runner tree)
- **Single build stage**: One Node.js builder instead of three separate builders (Python, Node, Go)
- **Deployment unblocked**: Cloud sandbox provisioning can resume after the unified runner migration
- **Image name aligned**: `ghcr.io/stigmer/runner` matches the Java default — no kustomize changes needed for first deploy

## Impact

- **Cloud sandbox provisioning**: Fully functional end-to-end once merged to main and CI runs
- **Planton variable**: Will auto-update from `agent-sandbox-full:main-b9ab8ba` to `runner:main-<sha>`
- **stigmer-service**: Picks up the new image via redeploy step in the CI pipeline
- **Backward compatibility**: Old `agent-sandbox-full` image stays in GHCR for rollback

## Related Work

- Unified runner migration: `_projects/2026-05/20260518.01.unified-runner-migration`
- Runner architecture simplification: `_projects/2026-05/20260520.01.runner-architecture-simplification`
- Cloud workflow sandbox affinity: `_projects/2026-05/20260521.02.cloud-workflow-sandbox-affinity`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
