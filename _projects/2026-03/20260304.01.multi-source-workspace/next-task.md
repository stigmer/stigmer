# Next Task: 20260304.01.multi-source-workspace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260304.01.multi-source-workspace

**Description**: Enable sessions to support multiple workspace sources (local paths and git repos) treated as a single unified workspace, mirroring VS Code's multi-root workspace model.
**Goal**: Allow users to pass multiple --workspace flags to stigmer run, so an agent can operate across multiple directories/repos in a single session.
**Tech Stack**: Protobuf (buf), Go (CLI), Python (agent-runner backend)
**Components**: Proto APIs (session/v1), CLI (client-apps/cli), Backend provisioner (agent-runner), Workspace backend, System prompt generation

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260304.01.multi-source-workspace/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-04
**Current Task**: Phase 5 — Tests + Polish
**Status**: COMPLETE — All 5 phases done; MVP feature-complete

## Session Progress (2026-03-04, Session 5)

### Phase 5: Tests + Polish — COMPLETE

**What was accomplished:**
- Integration tests in `test_multi_workspace_integration.py`: full pipeline (provision_all → tree enrichment → build_workspace_prompt_section) with real backends and temp dirs; multi-local, single local/git backward compat, multi-git; guard-rails for backend replacement and referenced-files primary root.
- Guard-rail tests: mixed local+git in `test_provisioner.py`; backend replacement and referenced-files in integration file.
- Daytona `cwd` conformance: `TestCwdConformance` in `test_daytona_backend.py` (4 tests).
- Heading-level polish: `tree_heading_level` threaded from provision_all through tree builder; string replace removed from `_build_multi_workspace_section`.
- All 1071 backend tests pass.

**Files changed:** tree.py, provisioner.py, execute_graphton.py; test_multi_workspace_integration.py (new), test_provisioner.py, test_daytona_backend.py, test_workspace_prompt_section.py.

**Checkpoint:** `checkpoints/2026-03-04-session-5.md`

## Session Progress (2026-03-04, Session 4)

### Phase 4: Backend Provisioner — Multiple Git Repos — COMPLETE

**What was accomplished:**
- Deep architectural analysis uncovered three concerns not anticipated in the original plan: backend replacement creating unreachable siblings, remote tree builder ignoring `root_dir`, and gitignore filter reading from wrong root
- Designed and implemented subdirectory-aware git provisioning via `target_subdir` parameter threading (no new backend types needed)
- Modified `provision_all()` to route multi-entry sessions through named subdirectories (`use_subdirs = len(entries) > 1`)
- Added multi-entry guard to backend replacement in `execute_graphton.py` — single entry replaces backend (backward compat), multi-entry keeps workspace root
- Scoped git diff artifact generation to per-entry subdirectories via `cwd` parameter; multi-entry patch naming: `{execution_id}-{entry_name}.patch`
- Fixed remote tree builder and gitignore filter to scope correctly via `cwd` and relative path prefixing
- 28 new tests across 4 test files, all 239 workspace tests + 53 prompt section tests passing

**Files changed (4 production, 4 test):**
- `backend/services/agent-runner/worker/workspace/sources/git.py` — `target_subdir` parameter, `_effective_root()`, `_scoped_path()` helpers, threaded through all 7 internal functions (+136 lines)
- `backend/services/agent-runner/worker/workspace/provisioner.py` — `target_subdir` in `provision()`, `_dispatch()`, `provision_all()` routing, `_relative_subdir()` helper, scoped `_enrich_with_file_tree` and `_load_gitignore_filter` (+66 lines)
- `backend/services/agent-runner/worker/workspace/tree.py` — `cwd` parameter on `build_workspace_file_tree()` and `_build_directory_tree_via_find()` (+13 lines)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — multi-entry backend guard, per-entry `cwd` for git diff, entry-name patch naming (+33 lines)
- `tests/workspace/test_git_source.py` — 12 new subdirectory tests (+187 lines)
- `tests/workspace/test_provisioner.py` — 4 new multi-git tests (+117 lines)
- `tests/workspace/test_tree.py` — 4 new cwd scoping tests (+82 lines)
- `tests/workspace/test_git_diff_artifact.py` — NEW FILE, 8 tests for per-entry cwd and naming

**Key design decisions:**
- D1: Thread `target_subdir` through git.py internals rather than creating per-entry backend instances — keeps changes local, avoids new types, works on both Local and Daytona backends
- D2: Skip backend replacement for multi-entry (`len(provision_results) > 1`) — workspace root stays as the container, all subdirectories remain reachable
- D3: Single entry clones into workspace root (backward compat), multiple entries clone into `{root}/{entry.name}/`
- D4: Patch naming `{execution_id}-{entry_name}.patch` for multi-entry, `{execution_id}.patch` for single

## Previous Sessions

### Phase 1: Proto Schema + Code Generation — COMPLETE
**Commit**: `e5e0704a feat(apis): add WorkspaceEntry and multi-workspace support to session proto`

### Phase 2: CLI Multi-Workspace Support — COMPLETE
**Commit**: `712e12b8 feat(cli): add repeatable --workspace/-w flag for multi-root sessions`

### Phase 3: Backend Provisioner — Multiple Local Paths — COMPLETE
**Commit**: `bb5eaf06 feat(backend/agent-runner): add multi-workspace provisioning (Phase 3 MVP)`

## Next Steps

1. **Pre-release (optional):** Regenerate stigmer-cloud stubs for `workspace_entries` before production ship.
2. **Known MVP limitations (documented by guard-rail tests):**
   - `build_referenced_files_prompt_section` uses single primary root — multi-root file referencing is future work.
   - Mixed local+git: local entry keeps original path; git entry gets subdir. Primary root heuristic may differ from expectations.
3. **Later:** E2E or infra-backed tests (real Daytona sandbox, real git clone) if needed.

## Context for Resume

- All 5 phases implemented. Multi-source workspace MVP is feature-complete.
- All 1071 backend tests pass (including 21 new integration + guard-rail tests).
- The `target_subdir` threading pattern is consistent: git.py uses it for clone/detect/recover/excludes, provisioner.py routes it, tree.py scopes remote find, execute_graphton.py scopes git diff.
- When `target_subdir` is `None`, every function behaves identically to before — zero regression risk for single-entry sessions.
- Agent CWD for multi-entry stays at workspace root (not primary's subdirectory) — system prompt compensates, worth monitoring in integration testing.

## Architecture Context

The multi-source workspace feature requires changes across 6 layers:
1. **Proto schema** — `WorkspaceEntry` type, `repeated workspace_entries` on `SessionSpec` **(DONE)**
2. **CLI** — Repeatable `--workspace` flag, multi-root attachment processing **(DONE)**
3. **Backend provisioner** — Iterate entries, per-entry provisioning **(DONE — local + git)**
4. **System prompt** — Multi-entry workspace description **(DONE)**
5. **Git provisioning** — Subdirectory cloning for cloud mode **(DONE)**
6. **Tests** — Multi-workspace scenarios **(DONE — unit + integration + guard-rails + Daytona cwd)**

## Quick Commands

After loading context:
- "Show project status" - Overview of progress (all phases complete)
- "Review guidelines" - Established patterns
- "Regenerate stigmer-cloud stubs" - Pre-release step when ready

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260304.01.multi-source-workspace/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
