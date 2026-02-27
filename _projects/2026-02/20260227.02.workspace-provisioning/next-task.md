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
- **Last Session**: 2026-02-28 — Phase 5 complete (Workspace Awareness in System Prompt)
- **Active Task**: Phase 6 (Local-Mode Input File Optimization) is the next phase to tackle
- **Branch**: `feat/workspace-provisioning`
- **Completed Phases**: Phase 0 (Targeted Refactor), Phase 1 (Proto Changes, AD-09 v3), Phase 2 (Workspace Provisioner Module), Phase 3 (Integration Wire-Up), Phase 4 (Platform-File Isolation, sub-project), Phase 5 (Workspace Awareness in System Prompt)

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

## Session Progress (2026-02-28, Session 7)

### Phase 5: Workspace Awareness in System Prompt — COMPLETED

Injected a `## Workspace` section into the agent system prompt when workspace provisioning is active. Agents now know whether they're in a cloned git repo, the user's local project, or an empty workspace.

**Changes:**
1. **`build_workspace_prompt_section()`** in `execute_graphton.py` — Pure function that takes `ProvisionResult | None` and returns the section string or empty string. Follows the same extraction pattern as `inject_attachments`.
2. **Prompt assembly ordering** — `instructions → Workspace → Skills → Input Files → Response Rules → Delegation Rules`. WHERE you work before HOW you work before WHAT data you have.
3. **Path reference fix** in `prompt_enhancement.py` — Updated stale `FILESYSTEM_CAPABILITY` examples from `bin/skills/` and `inputs/` to `.stigmer/skills/` and `.stigmer/inputs/` (Phase 4 miss).
4. **16 new tests** in `test_workspace_prompt_section.py` — All source types, None handling, section ordering.

**Architectural decision:** Workspace section built in `execute_graphton.py` (session-specific state), NOT in graphton's `prompt_enhancement.py` (generic agent capabilities). Follows the same pattern as skills and input files.

## Next Steps

Per the updated dependency graph:

```
Phase 0 ──┐
           ├── Phase 2 ── Phase 3 ──┬── Phase 4 ── Phase 5
Phase 1 ──┘  (all DONE)             │   (DONE)     (DONE)
                                     └── Phase 6
```

1. **Phase 6: Local-Mode Input File Optimization** (next) — `Attachment.local_path` field for symlink/copy bypass. When running in local mode with `local_path` set, skip storage download and instead symlink/copy the file directly.
2. **Push + PR** — The branch has 9 commits (Phases 0-5) that haven't been pushed yet. Consider opening a PR for review.

## Context for Resume

- All work is on branch `feat/workspace-provisioning` (9 commits ahead of main, not pushed)
- **Phases 0-5 are complete** — the full workspace provisioning pipeline is functional
- The feature flag `STIGMER_WORKSPACE_PROVISIONING_ENABLED` gates the entire provisioning path
- Phase 6 is the remaining phase — local-mode input file optimization (low risk, additive)
- The virtual platform mount (Phase 4) ensures zero-pollution for all workspace source types
- Agents now receive workspace context in their system prompt (Phase 5)

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

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-02/20260228.01.sp.platform-file-isolation/next-task.md` - Design and implement a session-root architecture where platform files (skills, inputs) are physically isolated outside the workspace root directory, with a managed symlink bridge for agent access. This ensures no workspace source type (git_repo, local_path, empty) has platform files polluting the user's project.
