# Next Task: e2e-declarative-workspace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260228.02.e2e-declarative-workspace

**Description**: End-to-end verification, documentation, and enhancement of the declarative track, workspace provisioning, and platform file isolation projects.

**Goal**: Ensure the entire flow works (server bootstrap -> draft -> apply -> run -> workspace provisioning -> file isolation), document it for customers, and fix the seedpack flow.

## Current Status

**Last Session**: 2026-02-28 (Session 3) -- T04 complete: workspace CLI flags wired end-to-end
**Active Task**: Ready for T05 (End-to-end testing)

| Task | Status | Description |
|------|--------|-------------|
| T01 | DONE | Architecture review -- 13 gaps identified, all three projects verified on main |
| T02 | DONE | Declarative track enhanced -- skill dirs + subdirectory scanning |
| T03 | DONE | Seedpack migration -- moved to root, gutted to thin wrapper, CLI-driven bootstrap, ~1,100 lines deleted |
| T04 | DONE | Workspace CLI flags -- `--workspace`, `--branch`, `--commit` added to `stigmer run agent` |
| T05 | NEXT | End-to-end testing -- 8 scenarios covering full flow |
| T06 | PENDING | Customer documentation -- getting started guide, reference docs |

## Session Progress (2026-02-28, Session 3)

### Major Accomplishments
- **T04 Complete**: Workspace provisioning wired end-to-end via CLI flags
  - Added `--workspace`, `--branch`, `--commit` flags to `stigmer run agent`
  - Created `run_workspace.go` (104 lines): pure parsing logic, flags -> `WorkspaceSource` proto
  - Created `run_workspace_test.go` (184 lines): 11 test cases covering all paths
  - Modified `run.go`: flag registration, `runOptions` fields, `executeRun`/`routeRun` wiring
  - Modified `run_handlers.go`: explicit session creation branch in `runAgent()`
  - Modified `run_create.go`: `createSessionForAgent()` using `SessionCommandController.Create()`
  - All tests pass, zero regressions across 21 test files

### Key Decisions Made
- **Explicit session creation** (not proto passthrough): `workspace_source` lives on `SessionSpec`, not `AgentExecutionSpec`. The backend's auto-create-session flow has no workspace passthrough. Rather than adding a field to `AgentExecutionSpec` (domain leakage), the CLI creates the session explicitly when workspace is provided. Zero proto or backend changes.
- **Separate flags** (not single `--workspace` with embedded syntax): `--workspace`, `--branch`, `--commit` as separate flags that map 1:1 to proto fields. Cleaner than URL fragment parsing (`#branch@commit`), follows `git clone --branch` conventions.
- **Workflows rejected**: `--workspace` with workflows produces a clear error ("workspace is an agent-level concept").

### Architecture
```
Without --workspace (unchanged):
  resolveAgent -> createAgentExecution(agentID) -> backend auto-creates session -> stream

With --workspace (new):
  resolveAgent -> parseWorkspaceSource -> createSessionForAgent(instanceID, workspaceSource) -> createAgentExecution(sessionID) -> stream
```

## Next Steps

1. **T05**: End-to-end testing -- 8 scenarios covering full flow
2. **T06**: Customer documentation -- getting started guide, reference docs

## Context for Resume

### What T04 Achieved
Users can now specify workspace sources when running agents:
```bash
# Git workspace
stigmer run agent code-reviewer --workspace https://github.com/acme/app -m "Review this repo"

# Git workspace with branch
stigmer run agent code-reviewer --workspace https://github.com/acme/app --branch feature/auth

# Local workspace (agent operates directly on user's files)
stigmer run agent code-reviewer --workspace . -m "Review my project"
```

The backend provisioner (`WorkspaceProvisioner`) reads `session.spec.workspace_source` and handles git clone, local path mounting, and credential scoping -- all unchanged. The feature flag `STIGMER_WORKSPACE_PROVISIONING_ENABLED` must be enabled on the server.

### Why T05 is Next
With all the building blocks in place (declarative track, seedpack bootstrap, workspace CLI wiring), T05 validates the complete pipeline end-to-end: server bootstrap -> draft -> apply -> run -> workspace provisioning -> file isolation.

## Essential Files

### Task Plans
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T04_0_plan.md` -- Workspace CLI flag
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T05_0_plan.md` -- E2E testing
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T06_0_plan.md` -- Documentation

### Checkpoints
- `checkpoints/CP01_initial_review_and_t02.md` -- Session 1 (T01+T02)
- `checkpoints/2026-02-28-session-2.md` -- Session 2 (T03)
- `checkpoints/2026-02-28-session-3.md` -- Session 3 (T04)

### Design Decisions
- `design-decisions/DD01_seedpack_location.md` -- Originally keep nested, overturned to move to root
- `design-decisions/DD02_declarative_skill_support.md`

### Key Code Files
- `client-apps/cli/cmd/stigmer/root/run_workspace.go` -- Workspace source parsing (new in T04)
- `client-apps/cli/cmd/stigmer/root/run_workspace_test.go` -- Workspace parsing tests (new in T04)
- `client-apps/cli/cmd/stigmer/root/run.go` -- Run command (modified in T04)
- `client-apps/cli/cmd/stigmer/root/run_handlers.go` -- Agent run handler (modified in T04)
- `client-apps/cli/cmd/stigmer/root/run_create.go` -- Session + execution creation (modified in T04)
- `seedpack/` -- Seedpack at repo root (migrated in T03)
- `client-apps/cli/internal/cli/daemon/daemon.go` -- CLI-driven bootstrap (added in T03)

### Execution Plans
- `.cursor/plans/t04_workspace_cli_flag_7ee32f0d.plan.md` -- T04 execution plan

## Quick Commands

- "Continue with T05" -- Start end-to-end testing
- "Continue with T06" -- Start customer documentation
- "Show project status" -- Get overview of progress

---

*Drop this file into chat to resume. Start by reading the latest checkpoint.*
