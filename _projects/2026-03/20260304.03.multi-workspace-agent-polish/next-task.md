# Next Task: 20260304.03.multi-workspace-agent-polish

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260304.03.multi-workspace-agent-polish

**Description**: Fix agent tool confusion (read vs read_file duplication) and adapt smart workspace context features — relevance signaling, runtime .gitignore filtering, and system prompt workspace descriptions — for multi-workspace sessions. Ensure agents operating across multiple --workspace entries have coherent tool sets, correct path resolution, and full workspace awareness.
**Goal**: Eliminate tool name duplication so agents see one tool per operation (read, not read_file), fix relevance signaling to resolve paths across all workspace entries, fix runtime .gitignore to load per-entry filters, and improve multi-workspace system prompts with explicit CWD and path resolution rules.
**Tech Stack**: Python (Graphton library, agent-runner worker), Go (CLI tool rendering)
**Components**: backend/libs/python/graphton (tool_wrappers, prompt_enhancement, filesystem backend), backend/services/agent-runner (execute_graphton, relevance, provisioner, workspace sources), client-apps/cli (toolrender)

## Current State

- **Status**: Complete
- **Last Session**: 2026-03-04 — Completed T05 (final integration pass)
- **Active Task**: None — all tasks complete
- **Commits**: `229e6f2d` (T01), `a7468869` (T02), `611ba688` (T03), pending (T04) on `feat/cli-tui-ux-hardening`

## Session Progress (2026-03-04, Session 5)

### T05: Tests and Verification (Final Integration Pass) — COMPLETED

- Ran full graphton test suite: 873 passed, 24 failed — all failures pre-existing and unrelated to T01-T04 (model registry `claude-haiku-4` → `claude-haiku-4.5` rename, summarization middleware API changes, pre-existing `test_edit_raises_when_text_not_found`)
- Ran full agent-runner test suite: 1093 passed, 0 failed — clean
- Focused T01-T04 test run: 252 graphton tests passed (1 pre-existing failure), 124 agent-runner tests passed — zero regressions
- Verified all T01 tests (alias descriptions + prompt guidance): `test_alias_tools_have_redirect_descriptions`, `test_filesystem_capability_discourages_alias_names` — pass
- Verified all T02 tests (relevance multi-root): 10 `TestMultiRootResolution` tests + 50 existing — all 60 pass
- Verified all T03 tests (hierarchical gitignore): 11 `TestMultiEntryGitignore` tests + 102 existing — all 113 pass
- Verified all T04 tests (multi-workspace prompt): 15 new tests + 49 existing — all 64 pass
- No linting errors in changed files
- Coverage review: no gaps identified — all source types, edge cases, and backward compat paths tested

## Session Progress (2026-03-04, Session 4)

### T04: Improve Multi-Workspace System Prompt — COMPLETED

- Architectural decision: prompt-builder-only approach — no changes to source provisioners (`local_path.py`, `git.py`, `empty.py`). The prompt builder generates context-appropriate descriptions from structured `ProvisionResult` fields (`source_type`, `entry_name`, `git_metadata`) rather than threading `is_multi_entry` through four layers of provisioning code.
- Added `_format_entry_description()` helper in `execute_graphton.py` — pattern-matches on `SourceType` to generate multi-workspace-appropriate descriptions per entry. Falls back to `workspace_description` for unknown source types.
- Rewrote `_build_multi_workspace_section()` with new `container_root: str` parameter. Preamble now includes explicit CWD (`**Current working directory**`), path resolution rules with entry-relative path example, and per-entry headings that show the entry path (`### {name} (\`{root_dir}\`)`).
- Updated `build_workspace_prompt_section()` signature — added optional `container_root: str = ""` (backward compatible). Forwarded to `_build_multi_workspace_section()` only.
- Updated call site to pass `workspace_backend.root_dir` as `container_root`.
- Removed "Your workspace is..." phrasing from multi-workspace context — replaced with "Workspace entry **{name}** is..." per source type.
- Updated 2 existing tests, added 12 new tests (CWD, path resolution, per-source-type descriptions, mixed sources, `_format_entry_description` direct tests, unknown-source fallback).
- All 64 prompt section tests pass, all 1093 agent-runner tests pass, all 21 integration tests pass.

## Previous Session Progress (2026-03-04, Session 3)

### T03: Fix Runtime .gitignore for Multi-Workspace — COMPLETED

- Added `_discover_entry_gitignores()` method to `FilesystemBackend` that scans immediate subdirectories of `root_dir` for `.gitignore` files at construction time
- Stores discovered filters as `dict[str, GitIgnoreFilter]` mapping subdirectory name to compiled filter
- Extended `_should_include()` with a third filtering layer: entry-level `.gitignore` patterns applied to paths within discovered subdirectories (root filter and entry filter are additive)
- All 113 filesystem backend tests pass (102 pre-existing + 11 new). Zero regressions.

## Previous Session Progress (2026-03-04, Session 2)

### T02: Fix Relevance Signaling for Multi-Workspace — COMPLETED

- Added `WorkspaceRoot` frozen dataclass in `relevance.py` (labeled entry root, keeps module dependency-free)
- Added `entry_name: str = ""` field to `ResolvedPath`
- Changed `resolve_workspace_paths` and `build_relevance_prompt_section` to accept `Sequence[WorkspaceRoot]`
- Implemented first-match-wins multi-root iteration: per candidate, try each root in order, break on first hit
- All 60 relevance tests pass, all 1082 agent-runner tests pass

## Previous Session Progress (2026-03-04, Session 1)

### T01: Discourage Tool Aliases via Descriptions + System Prompt — COMPLETED

- Extracted `_register_alias` helper and `_ALIAS_DESCRIPTION_TEMPLATE` in `tool_wrappers.py`
- Added canonical-name guidance to `FILESYSTEM_CAPABILITY` in `prompt_enhancement.py`
- All 139 graphton tests pass

## Next Steps

All tasks complete (T01-T05). Remaining work:

1. **Commit T04**: The T04 changes (`execute_graphton.py`, `test_workspace_prompt_section.py`) are uncommitted
2. **Manual verification**: Run `stigmer draft mcp-server` with two `--workspace` flags to confirm clean agent behavior in a live session

## Context for Resume

- T01 was a graphton-only change — no agent-runner or CLI modifications
- T02 was an agent-runner-only change — no graphton or CLI modifications
- T03 was a graphton-only change — no agent-runner, CLI, or API modifications
- T04 was an agent-runner-only change — no graphton, CLI, or source provisioner modifications. Architectural decision: prompt builder generates multi-workspace descriptions from structured `ProvisionResult` fields (separation of concerns: provisioners own data, prompt builder owns presentation).
- The pre-existing test failure `test_edit_raises_when_text_not_found` is a bug where the edit tool returns an error message string instead of raising `ValueError`. Not related to T01-T04.
- The branch `feat/cli-tui-ux-hardening` also carries CLI changes from project `20260304.02.inline-first-cli` — those are separate and uncommitted
- Known limitation in T03: local_path multi-workspace entries live outside the container root, so auto-discovery doesn't find their `.gitignore` files. Pre-existing limitation, no regression.

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.03.multi-workspace-agent-polish/dont-dos/`
6. [ ] All tasks complete — commit T04 and do manual verification

## Quick Commands

After loading context:
- "Commit T04" - Commit the pending multi-workspace prompt changes
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
