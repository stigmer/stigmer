# Sandbox Full Image CI Pipeline, Snapshot Builder, and Integration Tests

**Date**: April 9, 2026

## Summary

Completed the T01 sandbox infrastructure work and followed up with full CI pipeline coverage, snapshot builder configuration, and live integration tests against the Daytona API. The sandbox images are now clearly separated by role (basic for OSS, full for cloud/Daytona), the CI publishes both, and the snapshot builder uses the full image as its base. Integration tests validate the entire snapshot lifecycle.

## Problem Statement

The MCP server sandbox security project (T01) required enhanced sandbox images with all MCP server runtimes and an automated snapshot pipeline. Several gaps remained after the initial T01 implementation:

### Pain Points

- `Dockerfile.sandbox.full` was never published to GHCR — header explicitly said "NOT published, build yourself"
- The snapshot builder (`build_mcp_snapshot.py`) defaulted to the basic image, but cloud-mode Daytona snapshots need the full image with cloud CLIs
- No integration tests existed to validate Daytona snapshot/image APIs (snapshot creation, resolution, rotation)
- `Dockerfile.sandbox.full` uses `debian:bookworm-slim` which installs `python3` but not `python` — Daytona's `Image.pip_install()` generates `RUN python -m pip install ...` which would fail without a symlink
- No clear separation between the OSS sandbox image env var and the cloud snapshot base image env var

## Solution

A five-part implementation that completes the sandbox infrastructure foundation:

1. **Fix `Dockerfile.sandbox.full`** for Daytona compatibility and CI publishing
2. **Update CI pipeline** to build and push both sandbox images
3. **Separate snapshot builder configuration** with a dedicated env var
4. **Write integration tests** against the live Daytona API
5. **Run tests** to validate assumptions

## Implementation Details

### Dockerfile.sandbox.full Fixes
- Updated header to reflect its actual role: cloud sandbox for Daytona-based agent execution
- Added `unzip` to base utilities (required for AWS CLI install)
- Added `ln -sf /usr/bin/python3 /usr/bin/python` after Python3 install (required for Daytona's `Image.pip_install()`)
- Added `python --version` to verification step

### CI Pipeline (`release.sandbox.yaml`)
- Added a second build step for `Dockerfile.sandbox.full`
- Full image is `linux/amd64` only (several tools bundle x86_64 binaries: yq, kubectl, AWS CLI, Tekton CLI)
- Basic image remains multi-arch (`linux/amd64,linux/arm64`)
- Updated summary step to list both images with architecture details

### Snapshot Builder Configuration
- Changed env var from `STIGMER_SANDBOX_IMAGE` to `STIGMER_MCP_SNAPSHOT_BASE_IMAGE`
- Changed default from `agent-sandbox-basic:latest` to `agent-sandbox-full:latest`
- This cleanly separates OSS sandbox image selection from cloud snapshot builder base image

### Snapshot Resolver and Builder (T01)
- `worker/snapshot_resolver.py`: Daytona-native snapshot discovery using `stigmer-mcp-` prefix, in-memory caching with 5-minute TTL, thread-safe singleton
- `worker/activities/build_mcp_snapshot.py`: Temporal activity + workflow for automated snapshot creation with curated MCP server packages, plus rotation (keep last 3)
- `worker/config.py`: Snapshot resolution priority chain — env var override > SnapshotResolver > no snapshot
- `worker/worker.py`: Initializes SnapshotResolver at startup, registers BuildMcpSnapshot activity/workflow

### Integration Tests (`test_snapshot_lifecycle.py`)
- `TestSnapshotResolver`: 3 tests — resolve returns None for unknown prefix, caching works, invalidate clears cache
- `TestSnapshotCreation`: 2 tests — minimal snapshot from `python:3.11-slim`, pip_install on full image (skips gracefully when image not yet on GHCR)
- `TestSnapshotRotation`: 1 test — creates 2 test snapshots, verifies prefix-based filtering
- All tests use unique `stigmer-test-XXXXXXXX-` prefixes to avoid collision with production
- Cleanup in `finally` blocks ensures test snapshots are always deleted

## Benefits

- **Clear image separation**: basic for OSS/local, full for cloud/Daytona — no more confusion about which image to use where
- **Automated CI for both images**: No more manual builds of the full image
- **Validated Daytona APIs**: Integration tests confirm snapshot creation, listing, filtering, and resolver caching work against the live API
- **Caught the python symlink issue**: `Dockerfile.sandbox.full` would have failed `pip_install()` without the `python` symlink — now fixed and will be validated once the image is published
- **Clean env var separation**: `STIGMER_SANDBOX_IMAGE` for OSS, `STIGMER_MCP_SNAPSHOT_BASE_IMAGE` for cloud snapshot builder

## Impact

- **agent-runner**: New Temporal workflow/activity for automated snapshot management, resolver for Daytona-native snapshot discovery
- **CI/CD**: `release.sandbox.yaml` now publishes two images instead of one
- **Cloud operations**: Snapshot builder will use the full image (with cloud CLIs) as its base once published
- **Developer experience**: Integration tests provide confidence in Daytona API assumptions

## Related Work

- T01 plan: `_projects/2026-04/20260409.01.mcp-server-sandbox-security/tasks/T01_0_plan.md`
- Design decision: `design-decisions/002-automated-snapshot-lifecycle.md`
- Next: T02 will move stdio MCP server execution into the Daytona sandbox

---

**Status**: In Progress (full image not yet published to GHCR — requires first CI pipeline run)
**Timeline**: 1 session
