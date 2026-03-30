# Fix Skill Artifact Publishing in Daytona (Cloud) Mode

**Date**: March 30, 2026

## Summary

Three compounding bugs prevented skill artifacts from publishing correctly in Daytona cloud mode: the `write` tool silently failed to overwrite existing files, the `InlinePublisher` used mismatched path coordinate systems causing a double-prefix in `file_exists` lookups, and `.stigmer/` virtual-mount resolution was missing from the Daytona execute path. All three are now fixed with comprehensive test coverage including a live Daytona integration test.

## Problem Statement

When the `skill-creator` agent ran in Daytona (cloud) mode, the real-time skill artifact publishing feature ([changelog](../2026-03-30-153400-real-time-skill-artifact-publishing.md)) failed silently. The agent would write files and report success, but the content never changed, and the skill directory was never published as a single `DIRECTORY` artifact.

### Pain Points

- The `write` tool reported `"Successfully wrote N characters"` but file content remained unchanged — the agent retried in a loop, wasting tokens
- Skill directories were published as individual `FILE` artifacts instead of a single `DIRECTORY` artifact
- The `init_skill.py` scaffold script could not run in cloud mode because `.stigmer/` paths were not resolved to `$STIGMER_PLATFORM_DIR`

## Solution

Identified and fixed three distinct bugs in the Daytona backend, write tool, and InlinePublisher, each confirmed via test-driven development.

## Implementation Details

### Bug 1: Write Tool Silently Fails to Overwrite Existing Files

**Root cause**: `DaytonaBackend.write` (from `deepagents-cli`) has **create-only** semantics — it returns `WriteResult(error="... already exists")` instead of raising an exception. `WorkspaceNormalizingBackend.write` was annotated `-> None` and discarded this return value. The `write` tool saw no exception and reported success.

**Confirmed** via a live Daytona integration test (`TestDaytonaWriteOverwrite`) that seeds a file via `sandbox.process.exec`, attempts overwrite via `backend.write()`, and asserts the content is unchanged — definitively proving create-only semantics.

**Fix** (two layers of defense):
- `WorkspaceNormalizingBackend.write`: detects the "already exists" error, deletes the file via `rm -f`, retries the write, and raises `RuntimeError` if the retry also fails
- `write` tool in `tool_wrappers.py`: defensively inspects the return value of `backend.write()` for an `.error` field, surfacing the error to the LLM instead of false success

### Bug 2: InlinePublisher Path Coordinate Mismatch

**Root cause**: `InlinePublisher._normalize` used `DaytonaWorkspaceBackend._normalize`, which produces **sandbox-relative** paths (with `workspace/` rebase prefix). But `_find_skill_root` passed these to `workspace_backend.file_exists`, which uses `_abs()` expecting **workspace-relative** paths — resulting in a double prefix like `/home/daytona/workspace/workspace/infra-chart-composer/SKILL.md`.

**Fix**: Separated normalization into two methods:
- `_to_workspace_relative()`: strips leading `/` for `file_exists` and skill-root cache
- `_to_sandbox_path()`: applies rebase prefix via `workspace_backend._normalize` for `publish_artifact` / `sandbox.fs.get_file_info`

### Bug 3: `.stigmer/` Path Resolution Missing from Daytona Execute

**Root cause**: The recent [fix-llm-path-confusion](../2026-03-30-162814-fix-llm-path-confusion-in-skill-execution.md) change added `resolve_platform_command` to `FilesystemBackend.execute` and `LocalWorkspaceBackend.execute` but missed `WorkspaceNormalizingBackend.execute` for Daytona mode. Agent commands like `python3 .stigmer/skills/skill-creator/scripts/init_skill.py` failed in cloud mode.

**Fix**: Added `resolve_platform_command` call in `WorkspaceNormalizingBackend.execute` when `STIGMER_PLATFORM_DIR` is present in `env_vars`, giving parity with `FilesystemBackend`.

## Benefits

- The `write` tool now actually overwrites files in Daytona mode, eliminating the retry loop and token waste
- Skill directories publish as single `DIRECTORY` artifacts in real time, enabling the frontend's "Skill detected" badge during streaming
- `init_skill.py` scaffold script works in cloud mode via proper `.stigmer/` resolution
- 17 new tests provide regression coverage: 5 write-overwrite unit tests, 4 `.stigmer/` resolution unit tests, 5 Daytona path-separation unit tests, and 3 live Daytona integration tests

## Impact

- **Agent Runner (Python)**: `WorkspaceNormalizingBackend.write`, `WorkspaceNormalizingBackend.execute`, `InlinePublisher`
- **Graphton library**: `write` tool in `tool_wrappers.py`
- **Skill Creator agent**: End-to-end flow now works correctly in cloud mode
- **Frontend**: Skill package detection fires during streaming (not just post-stream)

## Related Work

- [Real-time skill directory artifact publishing](../2026-03-30-153400-real-time-skill-artifact-publishing.md) — the feature this fix enables
- [Fix LLM path confusion in skill execution](../2026-03-30-162814-fix-llm-path-confusion-in-skill-execution.md) — introduced Bug 3 as a regression (`.stigmer/` resolution parity gap)

---

**Status**: ✅ Production Ready
