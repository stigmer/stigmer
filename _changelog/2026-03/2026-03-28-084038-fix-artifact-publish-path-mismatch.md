# Fix Artifact Publish Path Mismatch in Agent Runner

**Date**: March 28, 2026

## Summary

Fixed a production bug where files written by agents during execution were not appearing as downloadable artifacts. The root cause was a missing path normalizer on the worker's `DaytonaWorkspaceBackend`, causing the artifact publisher to look for files at the wrong sandbox path.

## Problem Statement

When an agent's `write` tool created a file (e.g., `mcp-server-stigmer.yaml`), the file was written successfully to the sandbox at `/home/daytona/workspace/mcp-server-stigmer.yaml`, but both the inline and post-stream artifact publishers failed with `Path not found in sandbox: mcp-server-stigmer.yaml`. The execution completed with `artifacts: 0` despite the write succeeding.

### Pain Points

- Files written by agents were invisible to users — no download artifact appeared in the execution UI
- Both the inline publish (fire-and-forget during streaming) and the AUTO_PUBLISH safety net (post-stream) failed identically
- The failure was silent from the user's perspective — the execution completed successfully but with no artifacts

## Solution

Added a `_normalize()` method and `sandbox_root` parameter to the worker's `DaytonaWorkspaceBackend`, matching the path normalization already present in graphton's `WorkspaceNormalizingBackend`. This fills the duck-typing contract that the publish code already checks via `hasattr(workspace_backend, "_normalize")`.

## Implementation Details

The bug existed because two separate backend objects handle paths differently:

1. **Graphton's `WorkspaceNormalizingBackend`** (used during writes) normalizes agent-space paths by prepending a rebase prefix (`workspace/`) before delegating to the inner Daytona backend. So `mcp-server-stigmer.yaml` becomes `workspace/mcp-server-stigmer.yaml`, which resolves to `/home/daytona/workspace/mcp-server-stigmer.yaml`.

2. **Worker's `DaytonaWorkspaceBackend`** (used during artifact publishing) lacked this normalization. The publish code checked `hasattr(workspace_backend, "_normalize")`, found nothing, and fell back to `path.lstrip("/")` — which left the path as `mcp-server-stigmer.yaml`, resolving to `/home/daytona/mcp-server-stigmer.yaml` (wrong location).

### Changes

- **`worker/workspace/daytona.py`**: Added optional `sandbox_root` parameter to constructor, rebase prefix computation, and `_normalize()` method that translates agent-space paths to sandbox-relative paths
- **`worker/workspace/__init__.py`**: Resolves sandbox root via `sandbox.get_work_dir()` (with fallback to `/home/daytona`) and passes it when constructing `DaytonaWorkspaceBackend`
- **`tests/workspace/test_daytona_backend.py`**: Added 11 tests covering rebase prefix computation, various path formats, no-rebase scenarios, and the `hasattr` detection contract

## Benefits

- Agent-written files now appear as downloadable artifacts in the execution UI
- Both inline publish and AUTO_PUBLISH safety net work correctly
- Backward compatible — local mode (no sandbox) is unaffected since `LocalWorkspaceBackend` correctly does not implement `_normalize`
- The `_normalize` logic mirrors graphton's existing implementation, maintaining consistency

## Impact

- **Users**: Files created by agents during execution are now visible and downloadable
- **Agent Runner**: The `DaytonaWorkspaceBackend` now satisfies the duck-typing contract expected by the artifact publishing pipeline
- **Risk**: Low — the change is additive and does not alter any existing code path

## Related Work

- `2026-03-27-090112-inline-artifact-publishing-during-streaming.md` — introduced the inline publish mechanism that first exposed this path mismatch

---

**Status**: ✅ Production Ready
