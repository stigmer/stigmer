# Task T01: Multi-Workspace Agent Polish — Full Plan

**Created**: 2026-03-04 08:03
**Revised**: 2026-03-04 (post-review, pre-approval)
**Status**: PENDING APPROVAL
**Type**: Feature Development

## Problem Statement

After the multi-source workspace project (`20260304.01`) added support for multiple `--workspace` entries, agents exhibit two categories of confusion:

1. **Tool duplication**: Agents see both `read` and `read_file` (plus `write`/`write_file`, `edit`/`edit_file`) in their tool list. They waste turns reasoning about which to use and whether the tools have different path semantics.

2. **Workspace disorientation**: In multi-workspace sessions, the system prompt describes multiple entries but runtime features (relevance signaling, `.gitignore` filtering) still assume a single root. Agents try `ls /` and fumble with path resolution.

## Root Causes (from investigation)

### Tool duplication

- **Graphton** registers canonical tools: `read`, `write`, `edit` (+ `execute`, `ls`, `glob`, `grep`, `search`)
- **Graphton** also registers aliases: `read_file`, `write_file`, `edit_file` — intended to override deepagents' in-memory versions
- **deepagents** `FilesystemMiddleware` internally creates its own `read_file`, `write_file`, `edit_file`
- Result: the LLM sees duplicate tools with identical descriptions
- Source: `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` lines 664-691

**Why we cannot simply remove the aliases**: The aliases serve two purposes:
1. Override deepagents' in-memory tools with real-filesystem-backed ones (now partially solved by `DeepAgentsBackendAdapter`)
2. **Carry approval checking** — deepagents' middleware-created tools bypass graphton's HITL approval flow. If the LLM calls `write_file` and the alias is gone, the write goes directly to disk without the user seeing "Do you want to write this file? [Yes/Skip/Reject]". This is a safety regression we must not introduce.

### Smart workspace context gaps

Features from `20260301.01.smart-workspace-context` that were NOT adapted for multi-workspace:

| Feature | File | Issue |
|---------|------|-------|
| Relevance signaling | `backend/services/agent-runner/worker/activities/relevance.py` | Uses `primary_root` only; paths in other entries silently ignored |
| Runtime `.gitignore` | `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` | Loads single `.gitignore` at container root; per-entry files not loaded |
| Multi-workspace prompt | `backend/services/agent-runner/worker/activities/execute_graphton.py` | Missing CWD statement, path resolution rules, and tool guidance |
| Per-source descriptions | `backend/services/agent-runner/worker/workspace/sources/local_path.py` | Phrased as "your workspace" even when it's one of many entries |

## Task Breakdown

### T01: Discourage Tool Aliases via Descriptions + System Prompt

**Goal**: Steer the LLM toward canonical tool names (`read`, `write`, `edit`) while preserving the aliases as a safety net that carries approval checking.

**Approach**: Two-pronged — change alias descriptions to mark them as internal, and add canonical-name guidance to the system prompt. The aliases remain registered (for approval safety) but the LLM is explicitly told not to use them.

**Files**:
- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — Change the docstrings of the 3 alias tools to clearly mark them as internal aliases that redirect to the canonical tool. Example: `"Internal alias for 'read'. Always prefer using 'read' instead of 'read_file'."`
- `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py` — Add canonical tool name guidance to `FILESYSTEM_CAPABILITY`: `"Use the canonical tool names: read, write, edit, execute, ls, glob, grep, search. Do not use alternative names like read_file or write_file."`
- `backend/libs/python/graphton/tests/core/test_tool_wrappers.py` — Verify alias descriptions contain the "alias" / "prefer" language

**Why this is safe**:
- Aliases stay registered with approval checking — if the LLM ignores the guidance and calls `write_file`, the user still gets the approval prompt
- No changes to deepagents integration, sub-agent inheritance, or tool routing
- Prompt guidance is additive — worst case the LLM ignores it and behavior is identical to today

**Verification**:
- Run existing graphton tests
- Run agent-runner tests
- Manual test: run `stigmer draft mcp-server` with two workspaces, observe which tool names the agent picks

### T02: Fix Relevance Signaling for Multi-Workspace

**Goal**: `build_relevance_prompt_section` resolves path candidates across ALL workspace entries, not just the primary.

**Files**:
- `backend/services/agent-runner/worker/activities/relevance.py` — Change `resolve_workspace_paths` to accept a list of roots and try each
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — Pass all `provision_results` roots to relevance builder (currently only passes `provision_results[0].root_dir`)
- `backend/services/agent-runner/tests/` — Update relevance tests for multi-root scenarios

**Design**:
- `resolve_workspace_paths(candidates, workspace_roots: list[str])` — iterate roots, first match wins
- Resolved paths annotated with which entry they belong to (for prompt clarity)
- Single-workspace backward compat: `[primary_root]` is just a list of length 1

### T03: Fix Runtime .gitignore for Multi-Workspace

**Goal**: `FilesystemBackend` loads per-entry `.gitignore` files, not just the container root's.

**Approach**: Option A — hierarchical gitignore. Load container `.gitignore` (if any) plus each entry subdirectory's `.gitignore`. Apply the entry-level filter when paths start with that entry's prefix.

**Files**:
- `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py` — Change gitignore loading to discover and merge `.gitignore` files from immediate subdirectories (workspace entries)
- `backend/libs/python/graphton/tests/core/test_filesystem_backend.py` — Add multi-gitignore tests

**Backward compat**: For single-workspace sessions, `root_dir` IS the workspace (not a container), so the existing single `.gitignore` at root still works. No regression.

### T04: Improve Multi-Workspace System Prompt

**Goal**: Agents in multi-workspace sessions know exactly where they are and how paths work.

**Files**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — Rewrite `_build_multi_workspace_section()`
- `backend/services/agent-runner/worker/workspace/sources/local_path.py` — Make `workspace_description` multi-workspace-aware
- `backend/services/agent-runner/worker/workspace/sources/git.py` — Same adaptation

**New multi-workspace prompt content**:
```
## Workspace

This session has {N} workspace entries.

**Current working directory**: `{container_root}`
**Path resolution**: All file tools (read, write, edit, ls, glob, grep) resolve paths
relative to the current working directory. Use absolute paths or entry-relative paths
(e.g., `{entry1_name}/src/main.py`).

### {entry1_name} (`{entry1_path}`)
{entry1_description}
{entry1_tree}

### {entry2_name} (`{entry2_path}`)
{entry2_description}
{entry2_tree}
```

**Per-source description changes**:
- Local path: "This is workspace entry **{name}**, the user's project directory at `{path}`."
- Git repo: "This is workspace entry **{name}**, initialized from {url}."
- Remove "Your workspace is..." phrasing when the entry is part of a multi-workspace session.

### T05: Tests and Verification

- Update graphton tests for alias description changes
- Add multi-root relevance tests
- Add multi-gitignore filesystem backend tests
- Run full agent-runner test suite
- Manual verification: run `stigmer draft mcp-server` with two `--workspace` flags and confirm clean agent behavior (no manual integration test for sub-agent tool inheritance — developer will test this manually)

## Execution Order

```
T01 (alias descriptions + prompt guidance)   [graphton only, safe, do first]
T02 (relevance multi-root)                   [agent-runner, independent]
T03 (gitignore hierarchical)                 [graphton, independent]
T04 (multi-workspace prompt)                 [agent-runner, independent]
T05 (tests + verification)                   [after all above]
```

T01 is the most visible user-facing fix and the safest to execute first. T02, T03, T04 are independent and can be done in any order or parallel sessions. T05 is the integration pass.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| LLM ignores prompt guidance, still picks `read_file` | Alias with approval still catches it — no safety regression, just suboptimal UX |
| Single-workspace regression from gitignore changes | T03 preserves existing single-root behavior (list of length 1) |
| Relevance multi-root changes affect prompt size | First-match-wins keeps prompt compact; no combinatorial explosion |
| Per-source description changes confuse single-workspace agents | Conditional phrasing — single-workspace gets existing "Your workspace is..." text |

## Decisions Made During Review

1. **T01 approach**: Keep aliases with approval, change descriptions + add prompt guidance (not removal — avoids approval bypass safety regression)
2. **T03 approach**: Option A — hierarchical gitignore (simpler, mirrors provisioning)
3. **Sub-agent testing**: Manual verification only, no integration test
4. **Priority**: T01 first (most visible), then T02/T03/T04 in any order
