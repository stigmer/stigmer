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
**Current Task**: Phase 4 — Backend Provisioner: Multiple Git Repos
**Status**: IN PROGRESS — Phases 1-3 complete (MVP reached), Phase 4 ready to start

## Session Progress (2026-03-04)

### Phase 1: Proto Schema + Code Generation — COMPLETE

**What was accomplished:**
- Added `WorkspaceEntry` message to `workspace.proto` (name + source pair)
- Replaced singular `workspace_source` (field 6) with `repeated WorkspaceEntry workspace_entries` (field 7) on `SessionSpec`
- Reserved field 6 and name `workspace_source` for wire-format safety
- Regenerated all Go and Python stubs via `make protos`

**Commit**: `e5e0704a feat(apis): add WorkspaceEntry and multi-workspace support to session proto`

### Phase 2: CLI Multi-Workspace Support — COMPLETE

**What was accomplished:**
- Changed `--workspace` to repeatable `StringArrayVarP` with `-w` shorthand
- Added `parseWorkspaceEntries()`, `deriveEntryName()` and supporting functions
- Migrated all pipeline structs from singular `WorkspaceSource` to `WorkspaceEntries []*WorkspaceEntry`
- Updated session creation, attachments, and help text
- 11 new tests, 4 updated tests

**Commit**: `712e12b8 feat(cli): add repeatable --workspace/-w flag for multi-root sessions`

### Phase 3: Backend Provisioner — Multiple Local Paths — COMPLETE

**What was accomplished:**
- Extended `ProvisionResult` with `entry_name: str = ""` (backward-compatible, at end of frozen dataclass)
- Added `WorkspaceProvisioner.provision_all()` — iterates `WorkspaceEntry` protos, delegates to `provision()` per entry, stamps `entry_name` via `dataclasses.replace()`, fail-fast on error
- Rewrote `build_workspace_prompt_section()` for `list[ProvisionResult]` — single entry preserves legacy format, multi-entry generates preamble + per-entry `###` headings + adjusted `####` file tree headings
- Wired `execute_graphton.py`: replaced singular `workspace_source` check with `workspace_entries`, called `provision_all()`, updated backend replacement (primary = first entry), consumed keys union across all entries, heartbeat data, relevance section root, git diff artifact loop
- Added 7 new provisioner tests (`TestProvisionAll`) with `_MockWorkspaceEntry`
- Updated all 44 existing prompt section tests from singular to list API, added 7 new multi-entry tests (`TestMultiEntryWorkspacePromptSection`)
- All 78 tests pass

**Files changed:**
- `backend/services/agent-runner/worker/workspace/provisioner.py` — `entry_name` field, `provision_all()` method (+76 lines)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — multi-entry wiring (+141/-100 lines)
- `backend/services/agent-runner/tests/workspace/test_provisioner.py` — `TestProvisionAll` (+146 lines)
- `backend/services/agent-runner/tests/test_workspace_prompt_section.py` — list API migration + multi-entry tests (+154/-42 lines)

**Key design decisions:**
- Extended existing `ProvisionResult` instead of creating new `EntryProvisionResult` — DRY, no field duplication, backward-compatible via default value
- `entry_name` added at end of frozen dataclass with `str = ""` default — existing construction sites unaffected
- `provision_all()` uses duck-typing for proto entries (`.name`, `.source`) — no import dependency on generated stubs
- Single-entry output format preserved exactly — no regressions for single-workspace sessions
- Multi-entry preamble names the primary workspace and instructs the agent to navigate by absolute paths
- File tree headings adjusted from `###` to `####` in multi-entry mode to avoid conflicting with per-entry `###` headings
- Relevance section and referenced-files section use primary workspace root — acknowledged MVP limitation

## Next Steps

1. **Phase 4: Backend Provisioner — Multiple Git Repos** (Gaps 17, 19, 20, 25-27)
   - Handle git clone into subdirectories for cloud mode
   - Per-entry workspace backend creation or root management
   - Git diff artifact generation for each repo entry
2. **Phase 5: Tests + Polish** (Gaps 30-33)
   - Integration-level multi-workspace tests
   - Edge cases: mixed local+git entries, empty entries

## Context for Resume

- Phases 1-3 are committed and clean. **MVP milestone reached** — local multi-path workspaces work end-to-end.
- All 78 Python backend tests pass (provisioner + prompt section).
- The `provision_all()` method is generic enough to handle git entries in Phase 4 — it delegates to `provision()` which already dispatches by source type.
- `build_workspace_prompt_section()` already handles any number of entries — no further prompt changes needed for Phase 4.
- The `_generate_git_diff_artifact` loop already iterates all `provision_results` — Phase 4 just needs the git provisioning per-entry to work correctly.
- `build_referenced_files_prompt_section` still uses a single primary root — multi-root file referencing is a future enhancement.
- stigmer-cloud stubs are NOT regenerated yet.

## Architecture Context

The multi-source workspace feature requires changes across 6 layers:
1. **Proto schema** — `WorkspaceEntry` type, `repeated workspace_entries` on `SessionSpec` **(DONE)**
2. **CLI** — Repeatable `--workspace` flag, multi-root attachment processing **(DONE)**
3. **Backend provisioner** — Iterate entries, per-entry provisioning **(DONE — local paths)**
4. **System prompt** — Multi-entry workspace description **(DONE)**
5. **Git provisioning** — Subdirectory cloning for cloud mode
6. **Tests** — Multi-workspace scenarios **(partial — unit tests done)**

MVP milestone reached after Phase 3.

## Quick Commands

After loading context:
- "Start Phase 4" - Begin backend git multi-repo provisioning
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260304.01.multi-source-workspace/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
