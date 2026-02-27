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
- **Last Session**: 2026-02-27 -- Phase 1 (Proto Changes) completed
- **Active Task**: Phase 0 (Targeted Refactor) is the next phase to tackle
- **Branch**: `feat/workspace-provisioning`

## Session Progress (2026-02-27)

### Phase 1: Proto Changes -- COMPLETED

- Created `apis/ai/stigmer/agentic/session/v1/workspace.proto` with `WorkspaceSource` and `GitRepoSource` messages
- Modified `apis/ai/stigmer/agentic/session/v1/spec.proto` -- added `workspace_source` field (position 6) to `SessionSpec`
- Generated Go and Python stubs via `make go-stubs` and `make python-stubs`
- Gazelle auto-generated BUILD.bazel with `workspace.pb.go` included

### Key Design Decisions Made (Phase 1)

1. **`optional int32` over `google.protobuf.Int32Value`** for `depth` field -- codebase has zero wrapper type usage; modern proto3 `optional` provides identical presence semantics without new dependency
2. **Separate `branch` + `commit` over single `ref`** -- workspace provisioning needs both "which branch" and "which exact commit" as distinct concepts (diverges from skill/v1 Git message intentionally)
3. **CEL expression for HTTPS validation** -- follows established codebase pattern
4. **`oneof source` required on `WorkspaceSource`** -- empty `WorkspaceSource{}` is an invalid state; "no workspace" = absent field on `SessionSpec`

### Validation Results

- `buf lint` -- clean
- `buf breaking` -- clean (purely additive)
- `bazel build //apis/stubs/go/ai/stigmer/agentic/session/v1:session` -- compiles successfully

## Next Steps

Per the dependency graph:

```
Phase 0 ──┐
           ├── Phase 2 ── Phase 3 ──┬── Phase 4
Phase 1 ──┘ (DONE)                  └── Phase 5
```

1. **Phase 0: Targeted Refactor** (next) -- Extract `WorkspaceBackend` protocol interface from `execute_graphton.py`. This creates clean extension points for the provisioner to plug into. Medium risk, ~2 days.
2. **Phase 2: Workspace Provisioner Module** -- Depends on Phase 0 + Phase 1 (done). Implements `WorkspaceProvisioner`, git source, empty source, local path support.
3. **Phase 3-5**: Follow from Phase 2/3 per dependency graph.

## Context for Resume

- The proto files are on branch `feat/workspace-provisioning`
- Phase 0 requires deep familiarity with `backend/services/agent-runner/worker/activities/execute_graphton.py` (2800+ lines, 8+ `is_local_mode()` checks)
- Phase 0 targets ~3-4 mode checks for extraction, not all 8+ (targeted, not a rewrite)
- The full plan with all phases is at `_projects/2026-02/20260227.02.workspace-provisioning/tasks/T01_0_plan.md`
- Design decisions are at `_projects/2026-02/20260227.02.workspace-provisioning/design-decisions/`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/tasks/T01_0_plan.md
```

### 3. Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260227.02.workspace-provisioning/design-decisions/
```

### 4. Proto Files (Phase 1 output)
```
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/session/v1/workspace.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/session/v1/spec.proto
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Review `tasks/T01_0_plan.md` for Phase 0 details (next phase)
3. [ ] Check design decisions in `design-decisions/`
4. [ ] Familiarize with `backend/services/agent-runner/worker/activities/execute_graphton.py`
5. [ ] Continue with Phase 0 implementation

## Quick Commands

After loading context:
- "Continue with Phase 0" - Start the targeted refactor
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
