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
- **Last Session**: 2026-02-27 — Phase 0 (WorkspaceBackend Extraction) completed
- **Active Task**: Phase 2 (Workspace Provisioner Module) is the next phase to tackle
- **Branch**: `feat/workspace-provisioning`
- **Completed Phases**: Phase 1 (Proto Changes), Phase 0 (Targeted Refactor)

## Session Progress (2026-02-27, Session 2)

### Phase 0: WorkspaceBackend Extraction — COMPLETED

Extracted a deployment-agnostic `WorkspaceBackend` protocol from `execute_graphton.py`, eliminating all `is_local_mode()` conditionals for workspace operations. This was the "Complete" scope (~4 days), fully refactoring `SkillWriter` and `inject_attachments` internals.

**New files created (4):**
- `worker/workspace/backend.py` — `WorkspaceBackend` protocol + `ExecuteResult` dataclass
- `worker/workspace/local.py` — `LocalWorkspaceBackend` (pathlib + subprocess)
- `worker/workspace/daytona.py` — `DaytonaWorkspaceBackend` (Daytona SDK)
- `worker/workspace/__init__.py` — `initialize_workspace()` factory + public re-exports

**Major refactors (2):**
- `worker/activities/graphton/skill_writer.py` — merged dual-mode `_write_skills_local()`/`_write_skills_daytona()` into unified `write_skills()` via `WorkspaceBackend`
- `worker/activities/execute_graphton.py` — replaced ~8 `is_local_mode()` checks with backend usage, deleted `_check_workspace_file_exists()` helper

**Test updates (8 files):**
- Rewrote `test_skill_writer.py` (36+ tests → 30 focused tests)
- Rewrote `test_inject_attachments.py` (34 tests → 24 focused tests)
- Rewrote `test_workspace_integrity_check.py` to test `WorkspaceBackend.file_exists()`
- New `tests/workspace/test_local_backend.py` — unit tests for LocalWorkspaceBackend
- New `tests/workspace/test_daytona_backend.py` — unit tests for DaytonaWorkspaceBackend
- Updated `test_integration_skill_pipeline.py`, `test_integration_subagent_pipeline.py`, `test_subagent_transformer.py`

**Net diff**: 682 insertions, 1,874 deletions (−1,192 net lines removed)

### Key Design Decisions Made (Phase 0)

1. **`WorkspaceBackend` as a `Protocol` (structural typing)** — no forced inheritance; both `LocalWorkspaceBackend` and `DaytonaWorkspaceBackend` satisfy the protocol via duck-typing
2. **`execute()` method on the protocol** — added proactively for Phase 2's git clone needs, also used immediately for diagnostic listing and skill chmod
3. **`write_files()` batch method** — critical for Daytona cloud performance (batches `sandbox.fs.upload_files`)
4. **In-memory ZIP extraction** — unified across both backends; eliminates complex remote unzip commands
5. **`initialize_workspace()` factory** — centralizes mode-decision logic in one place; returns `(backend, sandbox, is_new_sandbox)` tuple
6. **Path traversal protection** — implemented in `LocalWorkspaceBackend._resolve()` with `resolve().relative_to()` guard
7. **Daytona `process.exec()` output mapping** — SDK returns combined `.output`, mapped to `ExecuteResult(stdout=output, stderr="")`

## Previous Session Progress (2026-02-27, Session 1)

### Phase 1: Proto Changes — COMPLETED

- Created `apis/ai/stigmer/agentic/session/v1/workspace.proto` with `WorkspaceSource` and `GitRepoSource` messages
- Modified `apis/ai/stigmer/agentic/session/v1/spec.proto` — added `workspace_source` field (position 6) to `SessionSpec`
- Generated Go and Python stubs via `make go-stubs` and `make python-stubs`
- Validated with `buf lint`, `buf breaking`, and `bazel build`

## Next Steps

Per the dependency graph:

```
Phase 0 ──┐
           ├── Phase 2 ── Phase 3 ──┬── Phase 4
Phase 1 ──┘ (both DONE)             └── Phase 5
```

1. **Phase 2: Workspace Provisioner Module** (next) — Depends on Phase 0 + Phase 1 (both done). Implements `WorkspaceProvisioner`, git source, empty source, local path support. Plugs into the `WorkspaceBackend` interface.
2. **Phase 3: Integration Wire-Up** — Wire provisioner into `execute_graphton.py`, update session handling.
3. **Phase 4-5**: Follow from Phase 3 per dependency graph.

## Context for Resume

- All Phase 0 work is on branch `feat/workspace-provisioning`
- The `WorkspaceBackend` protocol is the foundation that Phase 2's provisioner will use
- `initialize_workspace()` factory currently handles sandbox creation + backend instantiation; Phase 2 will extend this with workspace source provisioning (git clone, etc.)
- `execute_graphton.py` is now ~2,100 lines (down from ~2,700) — much cleaner
- `SkillWriter` and `inject_attachments` are now fully deployment-agnostic
- No `is_local_mode()` calls remain for workspace file operations

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-02/20260227.02.workspace-provisioning/checkpoints/
```

### 2. Full Project Plan
```
_projects/2026-02/20260227.02.workspace-provisioning/tasks/T01_0_plan.md
```

### 3. Design Decisions
```
_projects/2026-02/20260227.02.workspace-provisioning/design-decisions/
```

### 4. Phase 0 Output (WorkspaceBackend)
```
backend/services/agent-runner/worker/workspace/backend.py    — Protocol + ExecuteResult
backend/services/agent-runner/worker/workspace/local.py      — Local implementation
backend/services/agent-runner/worker/workspace/daytona.py    — Cloud implementation
backend/services/agent-runner/worker/workspace/__init__.py   — Factory + exports
```

### 5. Proto Files (Phase 1 Output)
```
apis/ai/stigmer/agentic/session/v1/workspace.proto
apis/ai/stigmer/agentic/session/v1/spec.proto
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Review `tasks/T01_0_plan.md` for full project plan
3. [ ] Skim `worker/workspace/backend.py` to recall the protocol shape
4. [ ] Review Phase 2 requirements in the plan
5. [ ] Continue with Phase 2 implementation

## Quick Commands

After loading context:
- "Continue with Phase 2" — Start the workspace provisioner module
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
