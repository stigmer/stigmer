# AD-04: Output Delivery Is Workspace-Source-Dependent

**Date**: 2026-02-27
**Revised**: 2026-02-28 (post architectural review)
**Status**: Accepted (Revised -- Auto-PR deferred to fast-follow)
**Context**: Workspace provisioning architecture discussion

## Decision

The output delivery mechanism (how the agent's work products reach the user) must vary based on the workspace source and deployment mode, following the same principle as input delivery and workspace provisioning: **if files are already on the user's machine, skip the storage indirection.**

## Current Behavior (Before)

Both `publish_artifact` and `_auto_publish_written_files` always:
1. Read modified files from workspace
2. Upload to `ArtifactStorage` (R2 or local storage)
3. Generate presigned download URLs
4. Return URLs to user

This is correct for cloud mode (files are in a remote sandbox). It is wrong for local mode (files are already on the user's disk).

## MVP Behavior (Revised)

| Workspace Source | Mode | Output Strategy |
|---|---|---|
| `local_path` (runner-level) | local | **FileChangeReport** -- list of modified file paths. User runs `git diff` to review. |
| `git_repo` | cloud | **Existing artifacts** (download URLs) + **patch artifact** (`git diff` as `.patch` file). No change to existing mechanism. |
| `git_repo` | local | **FileChangeReport** + **patch artifact**. Files are already on disk. |
| `empty` | local | Report local file paths in artifact. No storage upload. |
| `empty` | cloud | Upload to storage, download URL. **No change** from current behavior. |

## Rationale for Deferring Auto-PR

The original plan included auto-PR creation (branch, commit, push, open PR via GitHub API) as part of this ADR. This has been deferred to a separate fast-follow project because:

1. **Auto-PR is a full GitHub integration feature**, not "output delivery." It involves branch naming conventions, commit message generation, GitHub API integration, permission handling, conflict resolution, and fallback strategies. This deserves its own project and ADR.

2. **The existing artifact mechanism works for cloud + git_repo with zero changes.** `_auto_publish_written_files` detects modified files regardless of whether the workspace started empty or was cloned from a repo. Adding a `git diff` patch artifact is ~20 lines of code.

3. **Auto-PR can be added later without breaking changes.** It is purely additive:
   - `ExecutionArtifact.pull_request_url` = new field (field 9 available)
   - `GitRepoSource.auto_pr` = new field with enum (not bool, to handle proto3 defaults)
   - `GitContext` with token = enhancement to `ProvisionResult`
   - No existing behavior changes

4. **Holding a raw `GITHUB_TOKEN` in memory for the entire execution duration** raises token-expiry and security concerns for long-running agents. The auto-PR project should address this properly (lazy token resolution).

## MVP Output: Patch Artifact for Git Workspaces

After agent execution completes, if workspace source is `git_repo`:
1. Run `git diff` in the workspace to capture all changes against the base commit
2. If there are changes, save as `{execution_id}.patch`
3. Upload the patch as an `ExecutionArtifact` alongside regular file artifacts
4. The existing `_auto_publish_written_files` handles individual files (unchanged)

The user gets:
- **Download URLs** for each modified file (existing, no change)
- **A `.patch` file** they can `git apply` to their local checkout (new, trivial)

## Key Invariant

The agent never knows about output delivery strategy. The agent writes files and the platform decides how to deliver them. Agent code is deployment-agnostic.

## Consequences

- `_auto_publish_written_files` gains a `workspace_context` parameter to determine source type
- For `git_repo` (cloud): existing upload + download URLs, plus a `.patch` artifact
- For `git_repo` (local): `FileChangeReport` (modified paths) + `.patch` artifact
- For `local_path` (runner-level): `FileChangeReport` only
- For `empty` (local): local file paths. For `empty` (cloud): download URLs (no change)
- CLI must handle `download_url` and `local_path` in artifact display
- `ProvisionResult` carries `GitMetadata` (repo URL, branch, base commit -- NO token) for patch generation
