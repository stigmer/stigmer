# Multi-Workspace System Prompt Improvement

**Date**: March 4, 2026

## Summary

Rewrote the multi-workspace system prompt section so agents operating across multiple `--workspace` entries receive explicit CWD information, path resolution rules, and context-appropriate per-entry descriptions. This is the fourth of five tasks in the multi-workspace agent polish project (`20260304.03`).

## Problem Statement

When agents operate in multi-workspace sessions (e.g., `--workspace frontend=... --workspace backend=...`), the system prompt told them about multiple entries but lacked critical orientation information. Agents did not know their current working directory, had no path resolution guidance, and saw generic "Your workspace is..." phrasing that was confusing when multiple entries existed.

### Pain Points

- No CWD statement: agents guessed their working directory and tried `ls /` to orient themselves
- No path resolution rules: agents did not know whether to use entry-relative or absolute paths
- Entry headings lacked paths: agents had to infer root directories from the description text
- "Your workspace is..." phrasing was misleading when the agent had multiple workspaces

## Solution

Rewrote `_build_multi_workspace_section()` in the agent-runner's prompt builder to emit a structured multi-workspace section with three components: a preamble (entry count, explicit CWD, path resolution rules with an example), per-entry blocks (heading with name and path, source-type-appropriate description, file tree), and a new `_format_entry_description()` helper that generates descriptions from structured `ProvisionResult` fields.

## Implementation Details

**Architectural decision**: Changed only the prompt builder (`execute_graphton.py`), not the source provisioners (`local_path.py`, `git.py`, `empty.py`). The `ProvisionResult` dataclass already carries all structured data needed (`source_type`, `root_dir`, `entry_name`, `git_metadata`). Pattern-matching on `SourceType` in the presentation layer is idiomatic and avoids threading `is_multi_entry` through four layers of provisioner code.

**New `_format_entry_description()`**: Generates multi-workspace descriptions per source type:
- `LOCAL_PATH`: "Workspace entry **{name}** is the user's project directory at `{path}`." + persistence warning
- `GIT_REPO`: "Workspace entry **{name}** was initialized from {url} (branch, commit)." + artifact capture note
- `EMPTY`: "Workspace entry **{name}** is an empty workspace." + create-files guidance
- Unknown: falls back to the source's own `workspace_description`

**Updated `build_workspace_prompt_section()`**: Added optional `container_root: str = ""` parameter, forwarded to the multi-entry path only. Single-entry path is unchanged — backward compatible.

**Test coverage**: 2 existing tests updated, 12 new tests added covering CWD, path resolution rules, per-source-type descriptions, mixed sources, direct helper tests, and unknown-source fallback. All 1093 agent-runner tests pass.

## Benefits

- Agents know exactly where they are (explicit CWD)
- Agents know how to reference files across entries (path resolution rules with example)
- Entry headings are self-documenting (`### frontend (\`/workspace/frontend\`)`)
- Per-entry descriptions are contextually appropriate (no more "Your workspace is..." in multi-workspace)
- Source provisioners remain clean and focused on data/provisioning — no presentation concerns leaked into the provisioning layer

## Impact

- **Agent-runner service**: Improved multi-workspace prompt generation
- **Agent behavior**: Agents in multi-workspace sessions will orient themselves faster and use correct path patterns
- **Single-workspace sessions**: Zero impact — the single-entry code path is untouched
- **Source provisioners**: Zero impact — no changes to `local_path.py`, `git.py`, or `empty.py`

## Related Work

- T01: Discourage tool alias usage via descriptions and prompt (`229e6f2d`)
- T02: Fix relevance signaling for multi-workspace (`a7468869`)
- T03: Hierarchical .gitignore for multi-workspace sessions (`611ba688`)
- T05: Final integration pass (remaining)

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour)
