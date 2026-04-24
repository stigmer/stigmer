# Unified Sandbox Image: Runner Baked In + 81% Size Reduction

**Date**: April 21, 2026

## Summary

Baked the agent-runner into `Dockerfile.sandbox.full` per DD01 (unified sandbox image) and optimized the image from 5.32 GB to 995 MB — an 81% size reduction. Removed all cloud CLIs (2.58 GB), fixed the root `.dockerignore` to exclude development artifacts (1.18 GB), and documented Daytona benchmark results alongside the Dockerfile.

## Problem Statement

Phase 2 of the agent-runner-as-resource project requires the runner to be part of the Daytona sandbox image so that `stigmer-service` can start it via `sandbox.process.exec()` after sandbox creation. The original `Dockerfile.sandbox.full` was a cloud CLI toolkit (~2 GB) with no runner code. DD01 called for baking the runner in, but the naive approach produced a 5.32 GB image.

### Pain Points

- No agent-runner in the sandbox image — Daytona sandboxes couldn't run the Temporal worker
- Root `.dockerignore` didn't exclude Python development artifacts (`.venv/`, `.mypy_cache/`, `build/`, `dist/`), inflating COPY layers by ~1.2 GB
- Cloud CLIs (gcloud 967 MB, az 627 MB, pulumi 295 MB, aws 242 MB, etc.) added 2.58 GB for tools that most agents never use
- Runner start command had a latent bug (`python -m worker.main` — no such module; entry point is `main.py`)
- Release pipeline build context was too narrow for the new COPY statements

## Solution

Three-part optimization applied in a single session:

1. **Runner builder stage** — Added a `runner-builder` multi-stage build using `debian:bookworm-slim` (same base as the sandbox runtime) to build the Python virtualenv. Poetry pinned to 2.1.2 for reproducibility. Deepagents workaround and import verification gates carried over from the standalone Dockerfile.

2. **Cloud CLI removal** — Stripped all 10 cloud CLI installations. The sandbox image now contains only MCP server runtimes (npx, uvx, go run), core utilities (git, curl, jq, yq), and the agent-runner. Agents that need cloud CLIs can install them on-demand or use MCP snapshots.

3. **`.dockerignore` fix** — Added exclusions for `.venv/`, `__pycache__/`, `*.egg-info/`, `.mypy_cache/`, `.ruff_cache/`, `.pytest_cache/`, `build/`, `dist/`. This also fixes a pre-existing bloat issue in the standalone Dockerfile.

## Implementation Details

### Image size breakdown (after optimization)

| Component | Size |
|-----------|------|
| Runner virtualenv | 350 MB |
| Python3 + Node.js + npm | 240 MB |
| Go toolchain | 206 MB |
| Base OS + utilities | 97 MB |
| debian:bookworm-slim | 75 MB |
| uv / uvx | 59 MB |
| yq | 10 MB |
| Runner source + graphton + proto stubs | 7 MB |
| **Total** | **995 MB** |

### COPY layer improvement

| Layer | Before | After |
|-------|--------|-------|
| agent-runner source | 815 MB | 3.2 MB |
| graphton | 456 MB | 1.8 MB |

### Files changed

**stigmer:**
- `.dockerignore` — Added Python dev artifact exclusions
- `.github/workflows/release.sandbox-cloud.yaml` — Build context changed to repo root, path triggers widened
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` — Runner builder stage, cloud CLIs removed
- `backend/services/agent-runner/sandbox/PERFORMANCE.md` — Benchmark results and size breakdown
- `backend/services/agent-runner/poetry.lock` — Regenerated (pre-existing stale lock)

**stigmer-cloud (committed separately in Session 13):**
- `RunnerLauncherConfig.java` — Fixed start command to use absolute paths
- `application-runner-launcher.yaml` — Matching YAML default

## Benefits

- **81% image size reduction** — 5.32 GB to 995 MB (under 1 GB)
- **Faster CI builds** — fewer layers, smaller build context
- **Faster GHCR push/pull** — 4.3 GB less data to transfer
- **Sub-second sandbox creation** — confirmed via Daytona benchmark (1.03s)
- **Runner baked in** — Daytona sandboxes can now run the Temporal worker
- **Pre-existing bloat fixed** — standalone Dockerfile also benefits from `.dockerignore`

## Impact

- **Dockerfile.sandbox.full**: Complete restructure — multi-stage build with runner, stripped of cloud CLIs
- **release.sandbox-cloud.yaml**: Triggers on runner code changes, builds from repo root
- **Standalone Dockerfile**: Benefits from `.dockerignore` fix (smaller build context)
- **Cloud CLI users**: Must install tools on-demand or use layered MCP snapshots

---

**Status**: Production ready
**Timeline**: Single session
