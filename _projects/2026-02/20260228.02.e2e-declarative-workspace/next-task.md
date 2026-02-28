# Next Task: e2e-declarative-workspace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260228.02.e2e-declarative-workspace

**Description**: End-to-end verification, documentation, and enhancement of the declarative track, workspace provisioning, and platform file isolation projects.

**Goal**: Ensure the entire flow works (server bootstrap -> draft -> apply -> run -> workspace provisioning -> file isolation), document it for customers, and fix the seedpack flow.

## Current Status

**Last Session**: 2026-02-28 (Session 4) -- Workspace-aware file referencing implemented
**Active Task**: Ready for T05 (End-to-end testing)

| Task | Status | Description |
|------|--------|-------------|
| T01 | DONE | Architecture review -- 13 gaps identified, all three projects verified on main |
| T02 | DONE | Declarative track enhanced -- skill dirs + subdirectory scanning |
| T03 | DONE | Seedpack migration -- moved to root, gutted to thin wrapper, CLI-driven bootstrap, ~1,100 lines deleted |
| T04 | DONE | Workspace CLI flags -- `--workspace`, `--branch`, `--commit` added to `stigmer run agent` |
| T04a | DONE | Workspace-aware file referencing -- `--attach` skips upload for workspace files |
| T05 | NEXT | End-to-end testing -- 8 scenarios covering full flow |
| T06 | PENDING | Customer documentation -- getting started guide, reference docs |

## Session Progress (2026-02-28, Session 4)

### Major Accomplishments
- **T04a Complete**: Workspace-aware file referencing implemented end-to-end
  - **Proto**: Added `workspace_file_refs` (field 10) to `AgentExecutionSpec` -- simple `repeated string` for workspace-relative paths
  - **CLI**: `AttachmentProcessor.ProcessFiles` now accepts workspace root, splits attached files into workspace refs (skip upload) vs normal attachments (upload to R2)
  - **CLI**: Added `workspaceRelativePath()` containment check using `EvalSymlinks` + `filepath.Rel` -- prevents symlink escapes
  - **CLI**: New `AttachmentResult` struct carries both `Attachments` and `WorkspaceFileRefs`
  - **CLI**: `localWorkspaceRoot()` helper extracts local path from `WorkspaceSource`
  - **Backend**: New `build_referenced_files_prompt_section()` in `execute_graphton.py` -- builds `## Referenced Files` system prompt section with file sizes from `os.path.getsize`
  - **Tests**: 11 new Go test cases (7 containment + 4 ProcessFiles), 13 new Python test cases (9 builder + 4 ordering)
  - Go stubs and Python stubs regenerated via `make go-stubs python-stubs`
  - All CLI tests pass (21+ test files), all backend tests pass (29 in prompt section file)
  - Zero regressions

### Key Decisions Made
- **Transport vs attention separation**: `--attach` conflates two concerns -- transport (make file available) and attention (focus agent on it). For workspace files, transport is already satisfied; only attention is needed. This is the core domain insight.
- **Simple strings, not rich message**: `workspace_file_refs` uses `repeated string` (workspace-relative paths), not a structured message. The backend stats files from the workspace for size info. No metadata bloat on the proto.
- **Automatic detection** (not a new flag): The CLI automatically detects whether an attached file is inside the workspace. No `--ref` or `--focus` flag. `--attach` "just works."
- **Output optimization deferred**: Local workspace outputs are already on disk. The `publish_artifact` + `--download` round-trip is redundant but not harmful. Deferring to a separate task.

### Architecture
```
Without --workspace (unchanged):
  --attach -> upload to R2 -> Attachment{storage_key} -> inject at .stigmer/inputs/

With --workspace (local) + --attach inside workspace (new):
  --attach -> containment check -> workspace_file_ref -> ## Referenced Files prompt section
  
With --workspace (local) + --attach outside workspace:
  --attach -> normal upload -> Attachment{storage_key} -> inject at .stigmer/inputs/

Mixed scenario: both paths work simultaneously in a single execution.
```

## Next Steps

1. **T05**: End-to-end testing -- 8 scenarios covering full flow
2. **T06**: Customer documentation -- getting started guide, reference docs

## Context for Resume

### What T04a Achieved
When users attach files that are inside their local workspace, the system now:
- Skips upload to R2 (no wasted bandwidth)
- Skips injection to `.stigmer/inputs/` (no confusing duplicate)
- Records workspace-relative path as a `workspace_file_ref`
- Builds a `## Referenced Files` prompt section telling the agent to read from the real location
- Agent reads the REAL file at its REAL workspace path -- no copies, no semantic lies

```bash
# File inside workspace -> workspace ref (no upload)
stigmer run agent reviewer --workspace . --attach ./src/config.yaml -m "Review"

# File outside workspace -> normal attachment (uploaded)
stigmer run agent reviewer --workspace . --attach /tmp/external.csv -m "Analyze"

# Mixed -> both work simultaneously
stigmer run agent migrator --workspace ./myproject \
  --attach ./myproject/src/schema.sql \
  --attach /tmp/external-data.csv \
  -m "Migrate using external data"
```

### Why T05 is Next
With all the building blocks in place (declarative track, seedpack bootstrap, workspace CLI wiring, workspace-aware attachments), T05 validates the complete pipeline end-to-end.

## Essential Files

### Task Plans
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T04_0_plan.md` -- Workspace CLI flags
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T05_0_plan.md` -- E2E testing
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T06_0_plan.md` -- Documentation

### Checkpoints
- `checkpoints/CP01_initial_review_and_t02.md` -- Session 1 (T01+T02)
- `checkpoints/2026-02-28-session-2.md` -- Session 2 (T03)
- `checkpoints/2026-02-28-session-3.md` -- Session 3 (T04)
- `checkpoints/2026-02-28-session-4.md` -- Session 4 (T04a: workspace-aware file refs)

### Design Decisions
- `design-decisions/DD01_seedpack_location.md` -- Originally keep nested, overturned to move to root
- `design-decisions/DD02_declarative_skill_support.md`

### Key Code Files (modified in Session 4)
- `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` -- `workspace_file_refs` field added
- `client-apps/cli/cmd/stigmer/root/run_attachments.go` -- Containment check, `AttachmentResult`, `workspaceRelativePath()`
- `client-apps/cli/cmd/stigmer/root/run.go` -- `localWorkspaceRoot()`, workspace-aware attachment wiring
- `client-apps/cli/cmd/stigmer/root/run_handlers.go` -- `AttachmentResult` threading
- `client-apps/cli/cmd/stigmer/root/run_create.go` -- `WorkspaceFileRefs` on spec
- `backend/services/agent-runner/worker/activities/execute_graphton.py` -- `build_referenced_files_prompt_section()`

### Execution Plans
- `.cursor/plans/workspace-aware_file_referencing_824e33ad.plan.md` -- T04a execution plan

## Quick Commands

- "Continue with T05" -- Start end-to-end testing
- "Continue with T06" -- Start customer documentation
- "Show project status" -- Get overview of progress

---

*Drop this file into chat to resume. Start by reading the latest checkpoint.*
