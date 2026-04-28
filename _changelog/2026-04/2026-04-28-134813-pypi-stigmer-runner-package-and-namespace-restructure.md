# Publish Agent-Runner as `stigmer-runner` PyPI Package

**Date**: April 28, 2026

## Summary

Restructured the agent-runner service to use a proper `stigmer_runner` Python namespace, switched the build system from Poetry to hatchling (PEP 621), and created a CI release pipeline that publishes both `graphton` and `stigmer-runner` to PyPI on every version tag. Platform integrators can now `pip install stigmer-runner` and run a Temporal agent worker without needing the Go CLI or Docker.

## Problem Statement

The agent-runner was an application-only service with no standalone distribution story. Platform integrators who wanted to embed Stigmer's agent execution on their infrastructure had three options — the Go CLI sidecar, a Docker image, or cloning the repository. None of these served the Python-native ecosystem.

### Pain Points

- No `pip install` path for running agents outside of the CLI or Docker
- `worker/` and `grpc_client/` used generic top-level package names that would collide on PyPI
- `graphton`, the agent orchestration library, was only available as a monorepo path dependency
- The build system (Poetry with `package-mode=false`) couldn't produce distributable wheels
- CI had no workflow for publishing Python runner packages

## Solution

Introduced a proper `stigmer_runner` namespace package with hatchling build system, created a companion release workflow that publishes `graphton` first then `stigmer-runner`, and migrated Docker/CI infrastructure from Poetry to pip + `requirements.txt`.

## Implementation Details

### Namespace Restructuring (132 files)

Moved `worker/` and `grpc_client/` under `src/stigmer_runner/`, rewrote all imports across ~130 files. The import rewriting was mechanical: `from worker.config import Config` became `from stigmer_runner.worker.config import Config`. A thin `main.py` wrapper at the root preserves backward compatibility for Docker and development.

### Build System Migration

Replaced Poetry's `[tool.poetry]` with PEP 621 `[project]` metadata and hatchling as the build backend. Key additions:

- `[project.scripts]` entry point: `stigmer-runner = stigmer_runner.__main__:main`
- `[tool.hatch.build.targets.wheel]` with `packages = ["src/stigmer_runner"]`
- All runtime dependencies converted from Poetry syntax to PEP 508

### Docker Simplification

Both Dockerfiles (`Dockerfile`, `sandbox/Dockerfile.sandbox.full`) were migrated from Poetry-based installation to pip + `requirements.txt`. This eliminates the Poetry install step in Docker builds and uses the existing pinned requirements file that was already generated for the CLI embedding pipeline.

### CI Release Pipeline

Created `release.python-runner.yaml` with three jobs:

1. `determine-version` — strips `v` prefix from tag
2. `publish-graphton` — builds and publishes graphton to PyPI (OIDC trusted publishing)
3. `publish-runner` — builds and publishes stigmer-runner with graphton pinned to the same version

### graphton as Standalone Package

Verified that `graphton` (the declarative agent creation framework at `backend/libs/python/graphton/`) builds cleanly as a standalone wheel. The existing `pyproject.toml` with poetry-core backend and src layout required no changes for PyPI publishing.

### Downstream Updates

- `sync.sh` (CLI embedding) — updated to copy from `src/stigmer_runner/`
- `BUILD.bazel` — updated glob paths and imports directive
- `run.sh` — switched from `poetry run python` to direct venv execution
- CI workflows (`release.desktop.yaml`, `release.cli.yaml`, `release.sandbox-cloud.yaml`) — lint jobs migrated from Poetry to pip
- Agent-runner rule file — path references updated

## Benefits

- **Platform integrators** can `pip install stigmer-runner` for a pure Python deployment path
- **Proper namespacing** eliminates PyPI package name collision risk
- **Simpler Docker builds** — no Poetry installation step, faster layer caching
- **Two new PyPI packages** (`graphton`, `stigmer-runner`) expand the ecosystem
- **CI consistency** — runner release follows the same pattern as the existing Python SDK

## Impact

- **Python ecosystem**: New distribution channel for Stigmer's agent execution engine
- **Docker builds**: Faster and simpler (pip vs Poetry)
- **CI workflows**: Five workflows updated for new paths
- **Developer workflow**: `run.sh` now uses venv directly; Poetry is no longer required for running the service
- **No functional changes**: All application logic is identical; only packaging and import paths changed

## Related Work

- T02/T03: CI fix and hardening (same project, earlier tasks)
- `release.python-sdk.yaml`: Existing PyPI publishing pattern that this work mirrors
- T05 (upcoming): Runner documentation rewrite will reference the PyPI install path

---

**Status**: Production Ready (pending PyPI trusted publisher setup)
**Timeline**: Single session
