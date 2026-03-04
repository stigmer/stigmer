# Next Task: 20260304.03.multi-workspace-agent-polish

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260304.03.multi-workspace-agent-polish

**Description**: Fix agent tool confusion (read vs read_file duplication) and adapt smart workspace context features — relevance signaling, runtime .gitignore filtering, and system prompt workspace descriptions — for multi-workspace sessions. Ensure agents operating across multiple --workspace entries have coherent tool sets, correct path resolution, and full workspace awareness.
**Goal**: Eliminate tool name duplication so agents see one tool per operation (read, not read_file), fix relevance signaling to resolve paths across all workspace entries, fix runtime .gitignore to load per-entry filters, and improve multi-workspace system prompts with explicit CWD and path resolution rules.
**Tech Stack**: Python (Graphton library, agent-runner worker), Go (CLI tool rendering)
**Components**: backend/libs/python/graphton (tool_wrappers, prompt_enhancement, filesystem backend), backend/services/agent-runner (execute_graphton, relevance, provisioner, workspace sources), client-apps/cli (toolrender)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-03-04 — Completed T01, T02, and T03
- **Active Task**: T04 (next to start)
- **Commits**: `229e6f2d` (T01), `a7468869` (T02), pending (T03) on `feat/cli-tui-ux-hardening`

## Session Progress (2026-03-04, Session 3)

### T03: Fix Runtime .gitignore for Multi-Workspace — COMPLETED

- Added `_discover_entry_gitignores()` method to `FilesystemBackend` that scans immediate subdirectories of `root_dir` for `.gitignore` files at construction time
- Stores discovered filters as `dict[str, GitIgnoreFilter]` mapping subdirectory name to compiled filter
- Extended `_should_include()` with a third filtering layer: entry-level `.gitignore` patterns applied to paths within discovered subdirectories (root filter and entry filter are additive)
- Key semantic: `rel_path.split("/", 1)` ensures entry filters only apply to paths WITHIN the subdirectory, never to the subdirectory name itself
- Updated `_should_include` docstring to document the three-layer filtering architecture
- Added `TestMultiEntryGitignore` class with 11 test cases: entry-level filtering, cross-entry isolation, root+entry combination, directory listing item counts, backward compat
- Initial test used `dist/` as a test directory name — failed because `dist` is in `_SKIP_DIR_NAMES`. Fixed by using `build_output/` instead.
- All 113 filesystem backend tests pass (102 pre-existing + 11 new). Zero regressions.
- No API changes — constructor signature, `sandbox_factory.py`, and `execute_graphton.py` untouched

## Previous Session Progress (2026-03-04, Session 2)

### T02: Fix Relevance Signaling for Multi-Workspace — COMPLETED

- Added `WorkspaceRoot` frozen dataclass in `relevance.py` (labeled entry root, keeps module dependency-free)
- Added `entry_name: str = ""` field to `ResolvedPath`
- Changed `resolve_workspace_paths` and `build_relevance_prompt_section` to accept `Sequence[WorkspaceRoot]`
- Implemented first-match-wins multi-root iteration: per candidate, try each root in order, break on first hit
- Updated `_format_resolved_path` to append " — in **{entry_name}**" for multi-workspace entries
- Updated `execute_graphton.py` call site to build `WorkspaceRoot` list from all `provision_results`
- Updated all 50 existing tests to use `WorkspaceRoot` wrapper via `_single_root()` helper
- Added 10 new multi-root tests in `TestMultiRootResolution` class
- All 60 relevance tests pass, all 1082 agent-runner tests pass

## Previous Session Progress (2026-03-04, Session 1)

### T01: Discourage Tool Aliases via Descriptions + System Prompt — COMPLETED

- Extracted `_register_alias` helper and `_ALIAS_DESCRIPTION_TEMPLATE` in `tool_wrappers.py`
- Replaced 3 inline alias blocks with centralized `_register_alias()` calls
- Alias descriptions now read: "Internal override for 'read'. Do not call directly -- use 'read' instead (identical parameters and behavior)."
- Added canonical-name guidance to `FILESYSTEM_CAPABILITY` in `prompt_enhancement.py`
- Added `test_alias_tools_have_redirect_descriptions` in `test_tool_wrappers.py`
- Added `test_filesystem_capability_discourages_alias_names` in `test_prompt_enhancement.py`
- All 139 tests pass (1 pre-existing failure in `test_edit_raises_when_text_not_found` — unrelated)

## Next Steps

Per the plan in `tasks/T01_0_plan.md`, the remaining tasks are:

1. **T04**: Improve multi-workspace system prompt (`backend/services/agent-runner/worker/activities/execute_graphton.py`, workspace sources)
2. **T05**: Tests and verification (integration pass after T04)

T04 is the last feature task. T05 is the final integration pass.

## Context for Resume

- T01 was a graphton-only change — no agent-runner or CLI modifications
- T02 was an agent-runner-only change — no graphton or CLI modifications
- T03 was a graphton-only change — no agent-runner, CLI, or API modifications. Auto-discovery approach means zero coupling to provisioner.
- The pre-existing test failure `test_edit_raises_when_text_not_found` is a bug where the edit tool returns an error message string instead of raising `ValueError`. Not related to T01/T02/T03.
- The branch `feat/cli-tui-ux-hardening` also carries CLI changes from project `20260304.02.inline-first-cli` — those are separate and uncommitted
- Known limitation in T02: container-relative paths (e.g. `svc-api/src/main.go`) are not resolved — T04 will guide agents to use entry-relative paths
- Known limitation in T03: local_path multi-workspace entries live outside the container root, so auto-discovery doesn't find their `.gitignore` files. Pre-existing limitation, no regression.
- Daytona backend has the same single-root gitignore limitation — out of scope for T03, can follow the same pattern later if needed

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
6. [ ] Continue with the next task or complete the current one

## Quick Commands

After loading context:
- "Continue with T04" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
