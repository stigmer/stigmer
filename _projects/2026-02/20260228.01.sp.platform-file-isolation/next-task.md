# Next Task: 20260228.01.sp.platform-file-isolation

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260227.02.workspace-provisioning
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260227.02.workspace-provisioning
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/next-task.md`
**Spawned From Task**: T04

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260228.01.sp.platform-file-isolation

**Description**: Physically isolate platform files (skills, inputs) outside the workspace root using a virtual platform mount in the backend's path-resolution layer. The agent sees `.stigmer/` as if it's in the workspace, but files physically live in an external platform directory. Zero modifications to the user's project directory for any workspace source type.
**Goal**: Achieve true zero-pollution isolation of platform files from user workspaces. The backend's tool layer (`read`, `write`, `list_files`) routes `.stigmer/*` paths to an external platform directory. Shell access via `$STIGMER_PLATFORM_DIR` env var. No symlinks, no `.git/info/exclude` manipulation, no workspace modifications.
**Tech Stack**: Python (agent-runner, graphton), Protobuf (APIs), Go (CLI/server)
**Components**: apis/protos (session, agentexecution), backend/services/agent-runner (workspace provisioner, sandbox_manager, execute_graphton, prompt_enhancement), backend/libs/graphton (FilesystemBackend), client-apps/cli

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-28 01:23
**Current Task**: T01 (Platform-File Isolation — Virtual Platform Mount)
**Status**: COMPLETE — Phase A (local mode) and Phase C (integration tests) done. Phase B (cloud mode) concluded as no-op.
**Architecture**: Virtual platform mount (AD-01 v3) — zero pollution, backend routes `.stigmer/*` to external `platform_dir`

### Architecture Summary

Platform files physically live in an external `platform_dir` (e.g., `~/.stigmer/sessions/{id}/platform/`). The backend's path resolution routes `.stigmer/*` to that directory. Shell access via `$STIGMER_PLATFORM_DIR` env var. No symlinks, no workspace modifications.

### Key Files
- **Task Plan**: `tasks/T01_0_plan.md` (v3 — virtual mount, 12 sub-tasks)
- **Design Decision**: `design-decisions/AD-01-session-root-with-symlink-bridge.md` (v3 — virtual mount)
- **Research**: `research.session-root-filesystem-isolation/04.report.gpt.md`
- **Implementation Plan**: `.cursor/plans/virtual_platform_mount_350b474c.plan.md`

## Session Progress (2026-02-28)

### Accomplishments
- Implemented the complete virtual platform mount (AD-01 v3) across both backend layers
- Created shared `classify_platform_path()` classifier module (DRY — single routing decision)
- Replaced fragile tuple return from `initialize_workspace()` with `WorkspaceInitResult` dataclass
- Migrated all platform paths: `bin/skills` → `.stigmer/skills`, `.stigmer-inputs` → `.stigmer/inputs`
- Added `platform_dir` property to `WorkspaceBackend` protocol and all implementations
- Wired `platform_dir` through sandbox factory to agent runtime `FilesystemBackend`
- Conditional git diff exclusions and git excludes (active when virtual mount is on)
- Fixed pre-existing bug: `find -name` predicates used AND instead of OR in `_make_scripts_executable`
- 114 new tests across 4 test files, all passing
- Phase B concluded: cloud mode (Daytona) needs no virtual mount — `.stigmer/` paths resolve as physical dirs in disposable sandboxes

### Key Decisions
- **DRY classifier**: Shared `platform_mount.py` module avoids routing logic duplication across 4 backends
- **WorkspaceInitResult**: Frozen dataclass replaces opaque 3-tuple return from `initialize_workspace()`
- **Cloud mode = no-op**: Daytona sandboxes are disposable — `.stigmer/` paths work as physical dirs without virtual routing
- **Backward compatible**: When `platform_dir` is `None`, all behavior is identical to before the change

### Files Modified
**New files (3):**
- `backend/services/agent-runner/worker/workspace/platform_mount.py`
- `backend/libs/python/graphton/src/graphton/core/backends/platform_mount.py`
- `backend/services/agent-runner/tests/workspace/test_platform_mount_integration.py`

**Modified (15):** `backend.py`, `local.py`, `daytona.py`, `__init__.py`, `sources/git.py`, `skill_writer.py`, `execute_graphton.py`, `filesystem.py`, `sandbox_factory.py`, plus 6 test files

## Next Steps

T01 implementation is complete. Options for next session:

1. **Commit and PR** — Create a clean commit and pull request for T01
2. **T02 planning** — Review what the next task in the sub-project should be (e.g., session lifecycle, platform_dir cleanup)
3. **Return to parent** — Report back to `20260227.02.workspace-provisioning` and pick the next sub-project

## Context for Resume
- All 11 implementation steps from the plan are complete
- 786 agent-runner tests pass; 6 failures + 5 errors are pre-existing (old SkillWriter API)
- 550 graphton tests pass; 29 failures are pre-existing (model registry, summarization)
- The `find -o` bug fix in `_make_scripts_executable` was discovered during this session — it's a pre-existing bug exposed by our path change

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
