# Next Task: 20260227.02.workspace-provisioning

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260227.02.workspace-provisioning

**Description**: Redesign workspace provisioning and input file handling to make agent execution fully deployment-agnostic. Introduce WorkspaceSource (git repo, local path, empty), clean credential scoping, workspace-aware system prompts, and streamlined local-mode input files.
**Goal**: Make agent execution fully deployment-agnostic by properly separating workspace provisioning from agent logic, supporting multiple workspace sources (git, local path, empty), and ensuring input files and credentials flow correctly across local and cloud modes.
**Tech Stack**: Python (agent-runner, graphton), Protobuf (APIs), Go (CLI/server)
**Components**: apis/protos (session, agentexecution), backend/services/agent-runner (workspace provisioner, sandbox_manager, execute_graphton, prompt_enhancement), backend/libs/graphton (FilesystemBackend), client-apps/cli

## Current State

- **Status**: In Progress
- **Last Session**: 2026-02-28 — Phase 3 complete (Integration Wire-Up), architectural decision on Phase 4
- **Active Task**: Phase 4 (Platform-File Isolation) is the next phase to tackle
- **Branch**: `feat/workspace-provisioning`
- **Completed Phases**: Phase 0 (Targeted Refactor), Phase 1 (Proto Changes, AD-09 v3), Phase 2 (Workspace Provisioner Module), Phase 3 (Integration Wire-Up)

## Session Progress (2026-02-28, Session 5)

### Phase 3: Integration Wire-Up — COMPLETED (7 sub-tasks)

Wired the workspace provisioner into the execution flow in `execute_graphton.py`, gated behind `STIGMER_WORKSPACE_PROVISIONING_ENABLED` feature flag.

**Sub-tasks completed:**

1. **3.1 — Idempotent Git Provisioning** (`worker/workspace/sources/git.py`): Added `_detect_existing_repo()` for already-cloned workspaces, `_recover_non_empty_workspace()` for corrupted partial state, and `_setup_git_excludes()` to add `.stigmer-inputs` and `bin/skills` to `.git/info/exclude`. 9 new tests.

2. **3.7 — Sync/Async Fix** (`worker/workspace/provisioner.py`): Changed `async def provision()` to `def provision()` — all underlying operations are synchronous. Updated 8 provisioner tests to remove async/await.

3. **3.2 — Environment Merge Reorder** (`execute_graphton.py`): Moved entire environment merge block from Step 4 (after skills/attachments) to Step 2.8 (right after `initialize_workspace`). Provisioner now has access to `GITHUB_TOKEN` from merged env.

4. **3.3 — Provisioner Wire-Up** (`execute_graphton.py`): Feature flag gates provisioning. Calls `WorkspaceProvisioner.provision()` when enabled and session has `workspace_source`. Re-creates `LocalWorkspaceBackend` when `root_dir` differs.

5. **3.4 — Credential Stripping** (`execute_graphton.py`): Strips `consumed_keys` from `merged_env_vars` after provisioning, before MCP config transformation and status tracking. `GITHUB_TOKEN` never leaks to agent environment.

6. **3.5 — Input File Path Change** (`execute_graphton.py`): Default attachment mount path changed from `inputs/{filename}` to `.stigmer-inputs/{filename}`. System prompt updated with "read-only reference" guidance.

7. **3.6 — Git Diff Artifact** (`execute_graphton.py`): New `_generate_git_diff_artifact()` runs `git diff -- ':!.stigmer-inputs' ':!bin/skills'`, uploads as `{execution_id}.patch`. Non-fatal on failure.

**Modified files (5):**
- `worker/workspace/sources/git.py` — Idempotent provisioning + git excludes (+141 lines)
- `worker/workspace/provisioner.py` — Sync fix (+5/-1)
- `worker/activities/execute_graphton.py` — Env reorder, wire-up, stripping, input path, git diff (+359/-147)
- `tests/workspace/test_git_source.py` — 9 new idempotent/exclude tests (+178 lines)
- `tests/workspace/test_provisioner.py` — Async→sync test updates (+42/-42)

**Test results**: 97 passed, 0 failures, 0 regressions.

### Architectural Decision: Platform-File Isolation (AD-11)

During review, the user identified that `local_path` workspaces have a platform-file pollution problem: `bin/skills/` and `.stigmer-inputs/` get written directly into the user's project directory. For `git_repo` sources this is handled by `.git/info/exclude` (writes into a clone, not the user's repo). For `local_path`, there's no protection.

**Decision**: Do NOT use git excludes as a band-aid for `local_path`. Instead, design a proper platform-file isolation solution where skills and inputs live outside the workspace root entirely. This is the correct long-term architecture. **This becomes Phase 4.**

The previous Phase 4 (Workspace Awareness in System Prompt) and Phase 5 (Local-Mode Input File Optimization) are renumbered to Phase 5 and Phase 6 respectively.

## Next Steps

Per the updated dependency graph:

```
Phase 0 ──┐
           ├── Phase 2 ── Phase 3 ──┬── Phase 4 (NEW) ── Phase 5
Phase 1 ──┘  (all DONE)             │
                                     └── Phase 6
```

1. **Phase 4: Platform-File Isolation** (next) — Design and implement a solution where platform files (`bin/skills/`, `.stigmer-inputs/`) are stored outside the workspace root directory, so no source type (git_repo, local_path, empty) has platform files polluting the workspace. This is the core filesystem architecture and must be right. See `tasks/T04_platform_file_isolation.md` for the problem statement and design considerations.
2. **Phase 5: Workspace Awareness in System Prompt** — Inject `## Workspace` section using `ProvisionResult.workspace_description` and `GitMetadata`.
3. **Phase 6: Local-Mode Input File Optimization** — `Attachment.local_path` field for symlink/copy bypass.

## Context for Resume

- All work is on branch `feat/workspace-provisioning`
- **Phase 3 is done** — provisioner is fully wired into execution flow behind feature flag
- The feature flag `STIGMER_WORKSPACE_PROVISIONING_ENABLED` gates the entire provisioning path
- `_setup_git_excludes()` in `git.py` only runs for `git_repo` sources — this is correct for now
- **Phase 4 is the critical next step** — platform files must not pollute any workspace type
- The `.stigmer-inputs/` path change (sub-task 3.5) is already applied globally, but the underlying problem of WHERE those files physically live remains
- Skills are written by `skill_writer.py` to `bin/skills/` in the workspace — Phase 4 needs to change this
- `_generate_git_diff_artifact()` excludes platform dirs via pathspec — this exclusion pattern will need updating once platform files move out of the workspace root
- The provisioner itself is clean and doesn't need changes for Phase 4 — the change is in how `execute_graphton.py` places skills and inputs

## Essential Files to Review

### 1. Full Project Plan (revised)
```
_projects/2026-02/20260227.02.workspace-provisioning/tasks/T01_0_plan.md
```

### 2. Phase 4 Problem Statement (NEW)
```
_projects/2026-02/20260227.02.workspace-provisioning/tasks/T04_platform_file_isolation.md
```

### 3. Phase 3 Plan (implemented)
```
.cursor/plans/phase_3_integration_wire-up_9a17899c.plan.md
```

### 4. Phase 3 Output (Integration)
```
backend/services/agent-runner/worker/activities/execute_graphton.py
```

### 5. Phase 2 Output (Provisioner Module)
```
backend/services/agent-runner/worker/workspace/provisioner.py
backend/services/agent-runner/worker/workspace/sources/git.py
backend/services/agent-runner/worker/workspace/sources/local_path.py
backend/services/agent-runner/worker/workspace/sources/empty.py
backend/services/agent-runner/worker/workspace/__init__.py
```

### 6. Phase 0 Output (WorkspaceBackend)
```
backend/services/agent-runner/worker/workspace/backend.py
backend/services/agent-runner/worker/workspace/local.py
backend/services/agent-runner/worker/workspace/daytona.py
```

### 7. Proto Files (Phase 1 Output, revised)
```
apis/ai/stigmer/agentic/session/v1/workspace.proto
apis/ai/stigmer/agentic/session/v1/spec.proto
```

### 8. Skill Writer (Phase 4 target)
```
backend/services/agent-runner/worker/activities/graphton/skill_writer.py
```

## Resume Checklist

When starting a new session:

1. [ ] Read this file for current state
2. [ ] Read `tasks/T04_platform_file_isolation.md` for the Phase 4 problem statement
3. [ ] Skim `execute_graphton.py` around Step 2.9 (provisioning wire-up) and Step 3 (skills injection)
4. [ ] Skim `skill_writer.py` to understand how skills are currently written to workspace
5. [ ] Skim `inject_attachments()` in `execute_graphton.py` to understand input file placement
6. [ ] Design the platform-file isolation solution

## Quick Commands

After loading context:
- "Continue with Phase 4" — Start the platform-file isolation design
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
