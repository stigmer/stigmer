# PyPI Publishing Setup and stigmer-protos Rename

**Date**: March 16, 2026

## Summary

Set up PyPI publishing infrastructure for the Python SDK (`stigmer`) and proto stubs (`stigmer-protos`) packages using GitHub Actions with Trusted Publishers (OIDC). Renamed `stigmer-stubs` to `stigmer-protos` across the entire codebase for naming consistency with the npm ecosystem's `@stigmer/protos`.

## Problem Statement

The Python SDK had no publishing pipeline. After completing SDK codegen (Task 3), the packages could be built locally but had no automated path to PyPI. Additionally, the Python proto stubs package was named `stigmer-stubs`, which was inconsistent with the established `@stigmer/protos` naming used in the TypeScript/React ecosystem.

### Pain Points

- No CI/CD pipeline for Python package releases
- Package naming inconsistency between npm (`@stigmer/protos`) and PyPI (`stigmer-stubs`)
- No README for the PyPI package page (users see a blank page on pypi.org)
- Root Makefile release target didn't mention Python packages in its CI summary

## Solution

Three-pronged approach: rename for consistency, build the CI pipeline, and create the PyPI package page.

## Implementation Details

### 1. stigmer-stubs to stigmer-protos Rename

Cross-cutting rename across 8 source files with zero functional change:

- `apis/stubs/python/stigmer/pyproject.toml` — package name field
- `sdk/python/pyproject.toml` — dependency declaration
- `backend/services/agent-runner/pyproject.toml` — Poetry dependency key
- `backend/services/agent-runner/Dockerfile` — comment
- `client-apps/cli/embedded/agentrunner/sync.sh` — directory name and echo message
- `client-apps/cli/internal/cli/daemon/agent_runner_native.go` — path strings and comments
- `client-apps/cli/internal/cli/pythonrt/manager.go` — comments
- `client-apps/cli/embedded/agentrunner/agentrunner.go` — comments

The filesystem path `apis/stubs/python/stigmer/` was intentionally left unchanged — renaming it would cascade into `apis/Makefile` variables, Buf config, and more. The PyPI package name is what matters for external consistency.

### 2. GitHub Actions Workflow

Created `.github/workflows/release.python-sdk.yaml` with a 3-job pipeline:

- **determine-version**: Extracts version from git tag (`v*`) or `workflow_dispatch` input. Same pattern as `release.npm-libs.yaml`.
- **publish-protos**: Generates Python stubs via Buf, sets version, builds with `python -m build`, publishes via `pypa/gh-action-pypi-publish` using OIDC Trusted Publishers.
- **publish-sdk**: Runs Go codegen tool, sets version, builds, publishes. Depends on `publish-protos` since `stigmer` declares `stigmer-protos` as a runtime dependency.

Key design decisions:
- **OIDC authentication**: No API tokens or secrets — Trusted Publishers handle identity via OpenID Connect.
- **Sequential jobs**: Protos must publish before SDK. If protos fails, SDK publish is skipped.
- **PEP 517 build**: `python -m build` works with both `poetry-core` (protos) and `hatchling` (SDK).

### 3. Python SDK README

Created `sdk/python/README.md` covering installation, quick start, all 18 resource clients, CRUD operations, cross-resource search, error handling, and configuration. Wired into `pyproject.toml` via `readme = "README.md"` so it becomes the PyPI package page.

## Benefits

- Python SDK can now be published to PyPI automatically on tag push
- Consistent naming across npm and PyPI ecosystems
- Users see a complete package page on pypi.org with installation instructions and API reference
- Zero-secret publishing via OIDC eliminates token rotation burden

## Impact

- **Python SDK consumers**: Can `pip install stigmer` once first release is tagged
- **Agent-runner**: Local path references updated — functionally identical, naming consistent
- **CLI embedded builds**: sync.sh and Go code reference `stigmer-protos` instead of `stigmer-stubs`
- **Release workflow**: `make release` now echoes the Python SDK CI line

## Related Work

- Follows from: Python SDK codegen (Task 3) — Makefile + codegen pipeline
- Follows from: Python SDK handwritten runtime layer (Task 2) — StigmerClient, transport, interceptors
- Parallel: Java SDK codegen uses similar patterns

---

**Status**: Production Ready
**Timeline**: Session 4 of Python SDK codegen project
