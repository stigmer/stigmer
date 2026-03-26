# Remove `.patch` Artifact — Phase 4 Cleanup

**Date**: March 26, 2026

## Summary

Removed the `_generate_git_diff_artifact` function and associated infrastructure from the agent-runner. This `.patch` artifact was a stopgap from before the `create_pull_request` platform tool existed (Phase 3). With PR creation now a first-class capability, the diff lives on GitHub and the `.patch` file is redundant. The `_auto_publish_written_files` safety net remains for write/edit tool outputs.

## Problem Statement

The `.patch` artifact was introduced as a way to capture agent workspace changes when no explicit artifact publishing occurred. It ran `git diff` in the sandbox, uploaded the output to R2 storage, and surfaced it as a downloadable file in the execution viewer.

### Pain Points

- With `create_pull_request` now available, the diff is already on GitHub — the `.patch` is redundant for the primary use case
- The artifact system supports only `FILE` and `DIRECTORY` kinds — the originally planned "PR URL as artifact" would require either a new proto kind or a hacky text-file wrapper
- The `.patch` file rendered as a generic file card with no special diff viewer — limited user value
- ~115 lines of code and 11 tests to maintain for a stopgap that's no longer needed

## Solution

Removed the `.patch` artifact generation entirely:
- Deleted the `_generate_git_diff_artifact` function from `execute_graphton.py`
- Removed the call site in the post-stream safety net block
- Deleted the dedicated test file `test_git_diff_artifact.py`
- Removed a redundant test from `test_platform_mount_integration.py`

Dropped the "PR URL as artifact" plan — the agent communicates the PR URL in its conversational response, which is sufficient.

## Implementation Details

### Removed
- `_generate_git_diff_artifact()` in `execute_graphton.py` — the function that ran `git diff`, uploaded `.patch` to R2, and added it as an `ExecutionArtifact`
- The `for pr in provision_results: _generate_git_diff_artifact(...)` loop in the post-stream "Auto-Publish Safety Net" block
- `tests/workspace/test_git_diff_artifact.py` — 11 tests covering cwd scoping, naming, skip conditions
- `test_git_diff_with_no_platform_dir` from `test_platform_mount_integration.py` — redundant with `test_platform_dir_property_is_none`

### Unchanged
- `_auto_publish_written_files` safety net — continues to auto-publish files written via `write`/`edit` tools
- `ArtifactsWidget` / `ArtifactCard` — no frontend changes
- `StatusBuilder.add_artifact()` — other artifact types still use it
- `create_pull_request` platform tool — returns PR URL as a string in the agent's response
- Proto definitions (`ExecutionArtifact`, `ExecutionArtifactKind`) — no changes

## Benefits

- Cleaner codebase: ~115 lines of production code and 251 lines of test code removed
- Reduced maintenance burden: no tests to maintain for a deprecated feature
- Reduced R2 storage: no more uploading `.patch` files that users rarely download
- Clearer artifact semantics: artifacts are now consistently either explicit agent publications or auto-published written files

## Impact

- **Agent-runner**: Lighter post-stream finalization path
- **End users**: No visible change — `.patch` files were rarely useful in the artifact sidebar
- **Platform builders**: No SDK or proto changes

## Related Work

- Phase 3: `create_pull_request` platform tool (same session day, Session 4) — made the `.patch` redundant
- Phase 2: Write-back prompt — agent knows it can push and create PRs
- Phase 1: Git credential persistence — enables push from sandbox

---

**Status**: Production Ready
**Timeline**: Part of the sandbox-github-pr project (Phases 0–4), completed in Session 5
