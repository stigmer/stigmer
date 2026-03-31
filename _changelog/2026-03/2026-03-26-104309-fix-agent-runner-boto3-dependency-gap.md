# Fix Agent Runner boto3 Dependency Gap

**Date**: March 26, 2026

## Summary

Declared boto3 as an explicit dependency for the agent-runner service and removed the unnecessary lazy-import indirection it necessitated. The agent-runner defaults to Cloudflare R2 artifact storage in cloud mode, but boto3 (the S3-compatible SDK required by R2) was never listed in `pyproject.toml`, causing every cloud execution to fail with an `ImportError` at runtime.

## Problem Statement

Agent sessions on the cloud deployment (`app.stigmer.ai`) were failing immediately with:

> Error: Execution failed. (ImportError) boto3 is required for R2 storage. Install it with: pip install boto3

### Pain Points

- Every agent execution in cloud mode hit this error because R2 is the default artifact storage backend for cloud deployments
- The error surfaced only at runtime (during the first `create_artifact_storage()` call inside a Temporal activity), not at build time or startup
- The codebase treated boto3 as "optional" via lazy imports, but the configuration system made it mandatory by defaulting cloud mode to R2 storage -- an architectural inconsistency

## Solution

Made boto3 a first-class declared dependency and simplified the import graph to match that reality.

## Implementation Details

### 1. `pyproject.toml` -- Declare the dependency

Added `boto3 = "^1.35.0"` to `[tool.poetry.dependencies]` and regenerated the lockfile. This ensures Poetry installs boto3 into the virtualenv during `docker build`.

### 2. `worker/storage/r2.py` -- Top-level imports

Replaced the defensive try/except lazy-import pattern inside `R2ArtifactStorage.__init__` with straightforward top-level imports (`import boto3`, `from botocore.config import Config as BotoConfig`). Removed the dead `if TYPE_CHECKING: pass` block.

### 3. `worker/storage/__init__.py` -- Direct import

Replaced the `_get_r2_storage_class()` lazy-import wrapper and the `TYPE_CHECKING` conditional with a direct `from worker.storage.r2 import R2ArtifactStorage`. Cleaned the `create_artifact_storage` docstring to remove the now-impossible `ImportError` from `Raises`.

### Design decision: No Dockerfile verification step

The existing Dockerfile import-verification blocks for `deepagents` (namespace collision workaround) and LangGraph checkpointers (multi-package namespace resolution) are justified by specific, documented packaging defects. boto3 has no such issue -- it's a stable, well-packaged library. Adding a verification step would be cargo-culting the pattern without the justification.

## Benefits

- Cloud agent executions no longer crash with `ImportError` on the first message
- The dependency graph in `pyproject.toml` now accurately reflects what the service actually needs at runtime
- Simpler import graph: no lazy wrappers, no `TYPE_CHECKING` gymnastics, no defensive try/except blocks
- New engineers reading `pyproject.toml` can immediately see that R2/boto3 is part of the stack

## Impact

- **Agent Runner** (Python/Temporal worker): Direct fix -- cloud artifact storage now works
- **Cloud deployments**: All agent sessions that use the default R2 artifact storage are unblocked
- **Docker image**: Slightly larger due to boto3 + botocore (~80 MB uncompressed), but this is unavoidable for S3-compatible storage

## Related Work

- Agent artifact lifecycle implementation (2026-02-13 changelog) introduced the R2 storage module with the lazy-import pattern
- Workflow runner's Go-side R2 implementation (`workflow-runner/pkg/claimcheck/r2_store.go`) served as the reference design

---

**Status**: ✅ Production Ready
