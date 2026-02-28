# Fix LocalPathSource Agent Sandbox Wiring

**Date**: March 1, 2026

## Summary

The agent's file tools (read, write, ls, glob) resolved paths against an empty session directory instead of the user's project when `--workspace` pointed to a local path. Two bugs in `execute_graphton.py` prevented the provisioned workspace root from reaching the Graphton agent's sandbox backend.

## Problem Statement

Running `stigmer draft skill --workspace /path/to/project` succeeded at workspace provisioning (the Docker `$HOME:$HOME` mount fix landed earlier) but the agent inside the container could not read any workspace files. Every `read`, `ls`, and `glob` call returned "File not found" or empty results.

### Pain Points

- The agent was told to read workspace-relative paths (via `## Referenced Files` prompt section) but its file tools pointed at `/workspace/sessions/{id}/` — an empty directory.
- Skills written by the pre-agent `SkillWriter` ended up in the user's project directory (`.stigmer/skills/...`) instead of the platform directory, because the replacement workspace backend lost its `platform_dir`.
- The cloud-mode code path explicitly wired `workspace_root` from the provisioned backend, but the local-mode code path did not — a silent asymmetry.

## Solution

Two one-line fixes in `execute_graphton.py` that close the gap between workspace provisioning and agent sandbox configuration in local mode.

## Implementation Details

**Bug 1 — `sandbox_config_for_agent` root_dir not propagated (line ~1817)**

After `sandbox_config.copy()`, the local-mode path now sets `root_dir` from `workspace_backend.root_dir`. This mirrors what cloud mode already does with `workspace_root`. The Graphton `FilesystemBackend` (created by `sandbox_factory.py`) then receives the correct root.

**Bug 2 — Replacement backend drops `platform_dir` (line ~1274)**

When `LocalPathSource` provisioning changes the workspace root, the replacement `LocalWorkspaceBackend` now preserves `platform_dir` from `workspace_init`. This ensures `SkillWriter` routes `.stigmer/` writes to the platform directory instead of polluting the user's project.

## Benefits

- `stigmer draft skill --workspace .` and `stigmer run agent --workspace /path` correctly expose all workspace files to the agent in local mode.
- Skills are written to the platform directory and accessible to the agent through the virtual `.stigmer/` mount — no mismatch between write location and read location.
- Local-mode and cloud-mode sandbox configuration now derive the agent's workspace root from the same source (`workspace_backend.root_dir`), eliminating the asymmetry.

## Impact

- **Users**: Anyone using `--workspace` with a local path will now have working file tools inside the agent.
- **Seedpack tools**: Generation scripts (`02_draft-agent-creator-skill.sh` and similar) that pass `--workspace $REPO_ROOT` will no longer produce agents that cannot read their own workspace.
- **No API or proto changes**: The fix is purely in agent-runner activity wiring.

## Related Work

- Predecessor fix: `_changelog/2026-03/2026-03-01-042553-fix-local-workspace-docker-mount.md` (Docker `$HOME:$HOME` bind mount)
- Workspace provisioner: `backend/services/agent-runner/worker/workspace/sources/local_path.py`
- Sandbox factory: `backend/libs/python/graphton/src/graphton/core/sandbox_factory.py`

---

**Status**: ✅ Production Ready
