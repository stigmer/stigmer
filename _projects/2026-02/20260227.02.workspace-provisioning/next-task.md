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
- **Last Session**: 2026-02-28 — Phase 2 complete (Workspace Provisioner Module)
- **Active Task**: Phase 3 (Integration Wire-Up) is the next phase to tackle
- **Branch**: `feat/workspace-provisioning`
- **Completed Phases**: Phase 0 (Targeted Refactor), Phase 1 (Proto Changes, AD-09 v3), Phase 2 (Workspace Provisioner Module)

## Session Progress (2026-02-28, Session 4)

### Phase 2: Workspace Provisioner Module — COMPLETED

Implemented the full provisioner module: domain types, three source handlers, orchestrator, and 51 unit tests.

**Domain analysis corrections** applied to T01 plan:
- `SourceType` enum replaces stringly-typed `str`
- `dict[str, str]` for merged env (matches call-site reality, not proto wrapper)
- `tuple[str, ...]` for consumed_keys (true immutability on frozen dataclass)
- Non-empty directory guard added to git source
- Deferred imports to break circular dependency (matches `initialize_workspace` pattern)

**New files (9):**
- `worker/workspace/provisioner.py` — SourceType, GitMetadata, ProvisionResult, WorkspaceProvisionError, WorkspaceProvisioner
- `worker/workspace/sources/__init__.py` — Package docstring
- `worker/workspace/sources/empty.py` — Returns backend.root_dir unchanged
- `worker/workspace/sources/local_path.py` — Cloud rejection (AD-09 v3), path validation
- `worker/workspace/sources/git.py` — HTTPS clone, token injection (github.com), depth/branch/commit, error classification, token scrubbing
- `tests/workspace/test_provisioner.py` — Dispatch, prefix stripping, immutability
- `tests/workspace/test_git_source.py` — 19 tests: clone commands, auth, metadata, errors, scrubbing
- `tests/workspace/test_local_path_source.py` — 9 tests: valid paths, rejection, validation

**Modified files (1):**
- `worker/workspace/__init__.py` — Added exports for provisioner layer types

**Test results**: 88 passed (51 new + 37 existing), 0 failures, 0 regressions.

**Commit**: `d7b0d383` on `feat/workspace-provisioning`

## Previous Session Progress (2026-02-27, Session 3)

### AD-09 v3 Revision: LocalPathSource Restored to Proto — COMPLETED

Architectural review identified a fundamental flaw in the v2 decision (runner-level config for local paths). `LocalPathSource` was restored as a proper `oneof` variant in `WorkspaceSource`.

## Previous Session Progress (2026-02-27, Session 2)

### Phase 0: WorkspaceBackend Extraction — COMPLETED

Extracted a deployment-agnostic `WorkspaceBackend` protocol from `execute_graphton.py`. Net diff: -1,192 lines.

## Previous Session Progress (2026-02-27, Session 1)

### Phase 1: Proto Changes — COMPLETED

Created `workspace.proto` with `WorkspaceSource`, `GitRepoSource`, `LocalPathSource`. Added `workspace_source` field to `SessionSpec`.

## Next Steps

Per the dependency graph:

```
Phase 0 ──┐
           ├── Phase 2 ── Phase 3 ──┬── Phase 4
Phase 1 ──┘ (all DONE)              └── Phase 5
```

1. **Phase 3: Integration Wire-Up** (next) — Wire provisioner into `execute_graphton.py`, add workspace_state to session status, credential stripping, input file placement in `.stigmer-inputs/`, post-execution git diff artifact. Highest-risk phase (touches critical execution path). Feature flag: `STIGMER_WORKSPACE_PROVISIONING_ENABLED`.
2. **Phase 4: Workspace Awareness in System Prompt** — Inject `## Workspace` section using `ProvisionResult.workspace_description` and `GitMetadata`.
3. **Phase 5: Local-Mode Input File Optimization** — `Attachment.local_path` field for symlink/copy bypass.

## Context for Resume

- All work is on branch `feat/workspace-provisioning`
- **Phase 2 is done** — the provisioner is fully implemented and tested
- `WorkspaceProvisioner.provision()` returns a `ProvisionResult` with authoritative `root_dir`
- For `local_path`, `ProvisionResult.root_dir` differs from `backend.root_dir` — Phase 3 must re-create the backend
- `consumed_keys` tells the caller which env vars to strip before forwarding to the agent
- `workspace_description` is ready for Phase 4's system prompt injection
- The provisioner uses `backend.execute()` for git clone — works across both local and Daytona backends
- Source handlers are in `worker/workspace/sources/` (git.py, local_path.py, empty.py)
- Cloud runners reject `LocalPathSource` at provisioning time via `WorkspaceProvisionError`

## Essential Files to Review

### 1. Full Project Plan (revised)
```
_projects/2026-02/20260227.02.workspace-provisioning/tasks/T01_0_plan.md
```

### 2. Phase 2 Plan (detailed implementation spec)
```
.cursor/plans/phase_2_workspace_provisioner_04753f1d.plan.md
```

### 3. Phase 2 Output (Provisioner Module)
```
backend/services/agent-runner/worker/workspace/provisioner.py
backend/services/agent-runner/worker/workspace/sources/git.py
backend/services/agent-runner/worker/workspace/sources/local_path.py
backend/services/agent-runner/worker/workspace/sources/empty.py
backend/services/agent-runner/worker/workspace/__init__.py
```

### 4. Phase 0 Output (WorkspaceBackend)
```
backend/services/agent-runner/worker/workspace/backend.py
backend/services/agent-runner/worker/workspace/local.py
backend/services/agent-runner/worker/workspace/daytona.py
```

### 5. Proto Files (Phase 1 Output, revised)
```
apis/ai/stigmer/agentic/session/v1/workspace.proto
apis/ai/stigmer/agentic/session/v1/spec.proto
```

### 6. Integration Target (Phase 3)
```
backend/services/agent-runner/worker/activities/execute_graphton.py
```

## Resume Checklist

When starting a new session:

1. [ ] Read this file for current state
2. [ ] Review `tasks/T01_0_plan.md` Phase 3 section
3. [ ] Skim `worker/workspace/provisioner.py` to recall the ProvisionResult shape
4. [ ] Skim `execute_graphton.py` around line 967 (initialize_workspace call site)
5. [ ] Review Phase 3 execution flow changes (steps 1-11 in T01 plan)
6. [ ] Start Phase 3 implementation

## Quick Commands

After loading context:
- "Continue with Phase 3" — Start the integration wire-up
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
