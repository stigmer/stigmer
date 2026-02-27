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
- **Last Session**: 2026-02-27 — AD-09 v3 revision (LocalPathSource restored to proto)
- **Active Task**: Phase 2 (Workspace Provisioner Module) is the next phase to tackle
- **Branch**: `feat/workspace-provisioning`
- **Completed Phases**: Phase 0 (Targeted Refactor), Phase 1 (Proto Changes, revised with AD-09 v3)

## Session Progress (2026-02-27, Session 3)

### AD-09 v3 Revision: LocalPathSource Restored to Proto — COMPLETED

Architectural review identified a fundamental flaw in the v2 decision (runner-level config for local paths). The single-static-config approach breaks for multiple concurrent CLI invocations with different project directories. `LocalPathSource` was restored as a proper `oneof` variant in `WorkspaceSource`.

**Key insight**: The "invalid states should be unrepresentable" principle was applied too aggressively. `LocalPathSource` on a cloud runner is the same category as an SSH URL in `GitRepoSource` — a valid proto message rejected by deployment-specific validation at runtime. The proto already uses this pattern.

**Changes made:**
- `workspace.proto` — Added `LocalPathSource` message and `local_path` oneof variant
- Go and Python stubs regenerated
- `T01_0_plan.md` — Rewrote AD-09, updated Phase 1 proto section, Phase 2 provisioner section, Phase 2 tests, backward compatibility, out-of-scope
- `AD-09-local-path-runner-level.md` — Full v3 rewrite with decision history

**Phase 0 review**: No changes needed. WorkspaceBackend, LocalWorkspaceBackend, DaytonaWorkspaceBackend, and initialize_workspace are all workspace-source-agnostic. Clean foundation for Phase 2.

**Validation**: `buf lint` clean, `buf breaking` clean (additive, backward-compatible).

## Previous Session Progress (2026-02-27, Session 2)

### Phase 0: WorkspaceBackend Extraction — COMPLETED

Extracted a deployment-agnostic `WorkspaceBackend` protocol from `execute_graphton.py`, eliminating all `is_local_mode()` conditionals for workspace operations.

**Net diff**: 682 insertions, 1,874 deletions (-1,192 net lines removed)

## Previous Session Progress (2026-02-27, Session 1)

### Phase 1: Proto Changes — COMPLETED

- Created `workspace.proto` with `WorkspaceSource`, `GitRepoSource` messages
- Modified `spec.proto` — added `workspace_source` field to `SessionSpec`

## Next Steps

Per the dependency graph:

```
Phase 0 ──┐
           ├── Phase 2 ── Phase 3 ──┬── Phase 4
Phase 1 ──┘ (both DONE)             └── Phase 5
```

1. **Phase 2: Workspace Provisioner Module** (next) — Implements `WorkspaceProvisioner`, git source, local path source, empty source. Reads `WorkspaceSource` from session proto. Plugs into `WorkspaceBackend` interface.
2. **Phase 3: Integration Wire-Up** — Wire provisioner into `execute_graphton.py`, update session handling, workspace state.
3. **Phase 4-5**: Follow from Phase 3 per dependency graph.

## Context for Resume

- All work is on branch `feat/workspace-provisioning`
- `LocalPathSource` is now in the proto — the provisioner reads `workspace_source.local_path.path` per-session, NOT from runner config
- The `WorkspaceBackend` protocol is the foundation that Phase 2's provisioner will use
- `initialize_workspace()` factory creates the backend; Phase 2's provisioner sits on top for workspace source dispatching
- Cloud runners reject `LocalPathSource` at provisioning time (deployment validation)

## Essential Files to Review

### 1. Full Project Plan (revised)
```
_projects/2026-02/20260227.02.workspace-provisioning/tasks/T01_0_plan.md
```

### 2. Design Decisions
```
_projects/2026-02/20260227.02.workspace-provisioning/design-decisions/AD-09-local-path-runner-level.md
```

### 3. Proto Files (Phase 1 Output, revised)
```
apis/ai/stigmer/agentic/session/v1/workspace.proto
apis/ai/stigmer/agentic/session/v1/spec.proto
```

### 4. Phase 0 Output (WorkspaceBackend)
```
backend/services/agent-runner/worker/workspace/backend.py
backend/services/agent-runner/worker/workspace/local.py
backend/services/agent-runner/worker/workspace/daytona.py
backend/services/agent-runner/worker/workspace/__init__.py
```

## Resume Checklist

When starting a new session:

1. [ ] Read this file for current state
2. [ ] Review `tasks/T01_0_plan.md` Phase 2 section
3. [ ] Skim `worker/workspace/backend.py` to recall the protocol shape
4. [ ] Review `workspace.proto` to see `LocalPathSource` + `GitRepoSource`
5. [ ] Start Phase 2 implementation

## Quick Commands

After loading context:
- "Continue with Phase 2" — Start the workspace provisioner module
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
