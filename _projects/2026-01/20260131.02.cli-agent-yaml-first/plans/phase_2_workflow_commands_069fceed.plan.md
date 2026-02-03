---
name: Phase 2 Workflow Commands
overview: Create a dedicated `stigmer workflow` command group mirroring the agent command pattern, with get, delete, list, search, and run subcommands. Reuse existing infrastructure from run_*.go and follow the architectural patterns established in Phase 1.
todos:
  - id: sub1-workflow-internal
    content: "Sub-task 1: Create internal/cli/workflow/ package with get.go, delete.go, display.go, BUILD.bazel"
    status: pending
  - id: sub2-workflow-command-group
    content: "Sub-task 2: Create workflow.go command group and register in root.go"
    status: pending
  - id: sub3-workflow-get
    content: "Sub-task 3: Implement workflow_get.go with table/yaml/json output formats"
    status: pending
  - id: sub4-workflow-delete
    content: "Sub-task 4: Implement workflow_delete.go with interactive confirmation"
    status: pending
  - id: sub5-workflow-list
    content: "Sub-task 5: Create workflow_list.go placeholder command"
    status: pending
  - id: sub6-workflow-search
    content: "Sub-task 6: Implement workflow_search.go using existing search infrastructure"
    status: pending
  - id: sub7-workflow-run
    content: "Sub-task 7: Implement workflow_run.go reusing run_*.go infrastructure"
    status: pending
  - id: sub8-docs-cleanup
    content: "Sub-task 8: Documentation, changelog, and final cleanup"
    status: pending
isProject: false
---

# Phase 2: Workflow Command Restructuring

## Goal

Create a dedicated `stigmer workflow` command group that matches the agent command pattern. This provides consistent UX across resource types while reusing the substantial existing infrastructure (~800 lines in `run_*.go` files).

## Key Architectural Decisions

**Workflows remain SDK-synthesized** (not YAML-first like agents):

- Workflows require Go SDK code for orchestration logic
- Deployment via `stigmer apply` runs Go code and synthesizes resources
- This is intentional - workflows need implicit dependency tracking

**What we're building:**

- `stigmer workflow get <ref>` - Get by name/ID with table/yaml/json output
- `stigmer workflow list` - Placeholder until backend List API
- `stigmer workflow search <query>` - Search workflows
- `stigmer workflow delete <ref>` - Delete with interactive confirmation
- `stigmer workflow run <ref>` - Execute workflow (reusing run_*.go infrastructure)

**Not building `workflow apply**` - This would duplicate `stigmer apply` functionality. Workflows are deployed via SDK synthesis, not YAML files.

## Existing Infrastructure to Reuse

From `run_*.go` files:

- `resolveWorkflow()` - Reference resolution
- `createWorkflowExecution()` - Execution creation
- `streamWorkflowExecutionLogs()` - Log streaming
- `displayWorkflowPhaseChange()` - Status display
- `submitWorkflowApproval()` - Approval handling

From `internal/cli/agent/`:

- Pattern for get.go, delete.go, display.go structure
- Reference parsing via `pkg/reference`
- Display formatting patterns

## Backend APIs Available

```
WorkflowQueryController:
  - Get(WorkflowId) -> Workflow
  - GetByReference(ApiResourceReference) -> Workflow

WorkflowCommandController:
  - Apply(Workflow) -> Workflow
  - Delete(WorkflowId) -> Workflow
```

No List API exists (same as agents initially).

---

## Sub-task 1: Workflow Internal Package Foundation (45-60 min)

**Goal**: Create `internal/cli/workflow/` package with core operations.

**Files to create**:

1. `**internal/cli/workflow/get.go**` (~85 lines)
  - `GetFromBackend(conn, orgID, ref)` - Fetch via gRPC
  - `Get(opts *GetOptions)` - Structured options wrapper
  - Uses `reference.Parse()` for ID vs org/slug detection
  - Uses `WorkflowQueryController.Get/GetByReference`
2. `**internal/cli/workflow/delete.go**` (~78 lines)
  - `DeleteFromBackend(conn, workflowID)` - Low-level gRPC call
  - `Delete(opts *DeleteOptions)` - Structured wrapper
  - Uses `WorkflowCommandController.Delete`
  - Returns deleted workflow for confirmation
3. `**internal/cli/workflow/display.go**` (~150 lines)
  - `DisplayGetResult(workflow, format)` - table/yaml/json
  - `DisplayDeleteResult(result)` - Success message
  - `DisplayDeleteConfirmation(workflow)` - Pre-delete warning
  - Helper functions for consistent formatting
4. `**internal/cli/workflow/BUILD.bazel**`

**Pattern reference**: [internal/cli/agent/get.go](client-apps/cli/internal/cli/agent/get.go), [internal/cli/agent/delete.go](client-apps/cli/internal/cli/agent/delete.go)

**Testing**: Build via Bazel, verify package compiles

---

## Sub-task 2: Workflow Command Group (45-60 min)

**Goal**: Create `stigmer workflow` command group registered in root.

**Files to create/modify**:

1. `**cmd/stigmer/root/workflow.go**` (~80 lines)
  - `NewWorkflowCommand()` - Command group factory
  - Alias: `wf`
  - Long description explaining SDK synthesis model
  - Registers all subcommands
2. `**cmd/stigmer/root/root.go**` (modify)
  - Add `rootCmd.AddCommand(root.NewWorkflowCommand())`
3. `**cmd/stigmer/root/BUILD.bazel**` (modify)
  - Add `workflow.go` to sources

**Pattern reference**: [cmd/stigmer/root/agent.go](client-apps/cli/cmd/stigmer/root/agent.go) lines 15-72

**Testing**: `stigmer workflow --help` displays command group

---

## Sub-task 3: Workflow Get Command (45-60 min)

**Goal**: Implement `stigmer workflow get <ref>` with output formats.

**Files to create**:

1. `**cmd/stigmer/root/workflow_get.go**` (~115 lines)
  - `newWorkflowGetCommand()` - Cobra command
  - `workflowGetOptions` struct
  - `executeWorkflowGet()` - 5-step orchestration:
  1. Load backend config
  2. Resolve organization
  3. Ensure daemon (local mode)
  4. Connect to backend
  5. Fetch and display
    ags: `--output` (table/yaml/json), `--org`
2. **Update `workflow.go**` - Register get command
3. **Update `BUILD.bazel**` - Add workflow_get.go

**Pattern reference**: [cmd/stigmer/root/agent_get.go](client-apps/cli/cmd/stigmer/root/agent_get.go)

**Testing**: `stigmer workflow get <name>` returns workflow details

---

## Sub-task 4: Workflow Delete Command (60-75 min)

**Goal**: Implement `stigmer workflow delete <ref>` with interactive confirmation.

**Files to create**:

1. `**cmd/stigmer/root/workflow_delete.go**` (~150 lines)
  - `newWorkflowDeleteCommand()` - Cobra command
  - `workflowDeleteOptions` struct
  - `executeWorkflowDelete()` - 8-step orchestration:
  1. Load backend config
  2. Resolve organization
  3. Ensure daemon
  4. Connect to backend
  5. Fetch workflow for confirmation
  6. Interactive confirmation prompt
  7. Execute delete
  8. Display result
    onfirmWorkflowDeletion()`- Survey prompt ags:`--force`(skip confirmation),`--org`
2. **Update `workflow.go**` - Register delete command
3. **Update `BUILD.bazel**` - Add workflow_delete.go

**Pattern reference**: [cmd/stigmer/root/agent_delete.go](client-apps/cli/cmd/stigmer/root/agent_delete.go)

**Testing**: Delete with confirmation prompt works, `--force` bypasses prompt

---

## Sub-task 5: Workflow List Command (30-45 min)

**Goal**: Create placeholder list command (no backend List API yet).

**Files to create**:

1. `**cmd/stigmer/root/workflow_list.go**` (~50 lines)
  - `newWorkflowListCommand()` - Helpful placeholder
  - Message explaining List API not available
  - Suggests using `stigmer workflow get` instead
2. **Update `workflow.go**` - Register list command
3. **Update `BUILD.bazel**` - Add workflow_list.go

**Pattern reference**: [cmd/stigmer/root/agent_list.go](client-apps/cli/cmd/stigmer/root/agent_list.go)

**Testing**: `stigmer workflow list` shows helpful message

---

## Sub-task 6: Workflow Search Command (45-60 min)

**Goal**: Implement `stigmer workflow search <query>`.

**Files to create**:

1. `**internal/cli/workflow/display.go**` (extend)
  - `DisplaySearchResult(results, query, format, page)` - Search output
2. `**cmd/stigmer/root/workflow_search.go**` (~150 lines)
  - `newWorkflowSearchCommand()` - Cobra command
  - `executeWorkflowSearch()` - Search orchestration
  - Uses existing `internal/cli/search` package
  - Flags: `--output`, `--org`, `--page`
3. **Update `workflow.go**` - Register search command
4. **Update `BUILD.bazel**` - Add workflow_search.go

**Pattern reference**: [cmd/stigmer/root/agent_search.go](client-apps/cli/cmd/stigmer/root/agent_search.go)

**Testing**: Search returns relevant workflows with pagination

---

## Sub-task 7: Workflow Run Command (60-75 min)

**Goal**: Implement `stigmer workflow run <ref>` reusing existing infrastructure.

**Files to create**:

1. `**cmd/stigmer/root/workflow_run.go**` (~190 lines)
  - `newWorkflowRunCommand()` - Full-featured run command
  - `workflowRunOptions` struct
  - `executeWorkflowRun()` - Thin orchestration:
  1. Load and merge environment
  2. Connect to backend
  3. Resolve workflow
  4. Create execution
  5. Stream logs
    uses: `resolveWorkflow()`, `createWorkflowExecution()`, `streamWorkflowExecutionLogs()`
    ags: `--message/-m`, `--env`, `--env-file`, `--secret`, `--secret-file`, `--follow`, `--org`
2. **Update `workflow.go**` - Register run command
3. **Update `BUILD.bazel**` - Add workflow_run.go
4. **Update `run.go**` - Add deprecation warning for workflow runs (if not already present)

**Pattern reference**: [cmd/stigmer/root/agent_run.go](client-apps/cli/cmd/stigmer/root/agent_run.go)

**Testing**: `stigmer workflow run <name>` executes with log streaming

---

## Sub-task 8: Documentation and Cleanup (30-45 min)

**Goal**: Ensure consistency, update documentation.

**Tasks**:

1. Verify all commands have consistent help text
2. Ensure examples are accurate
3. Update `next-task.md` with Phase 2 completion status
4. Create changelog entry for Phase 2
5. Final review of all new files for coding guidelines

---

## File Summary

### New files:

```
internal/cli/workflow/
├── get.go          (~85 lines)
├── delete.go       (~78 lines)
├── display.go      (~180 lines)
└── BUILD.bazel

cmd/stigmer/root/
├── workflow.go          (~80 lines)
├── workflow_get.go      (~115 lines)
├── workflow_delete.go   (~150 lines)
├── workflow_list.go     (~50 lines)
├── workflow_search.go   (~150 lines)
└── workflow_run.go      (~190 lines)
```

### Modified files:

```
cmd/stigmer/root/
├── root.go        (add NewWorkflowCommand registration)
├── run.go         (add deprecation warning if needed)
└── BUILD.bazel    (add new sources)
```

## Success Criteria

- All workflow commands follow agent command patterns
- Zero code duplication - reuse existing run_*.go infrastructure
- Interactive confirmations using survey library
- Consistent output formats (table/yaml/json)
- Comprehensive examples in help text
- All tests passing
- Bazel build succeeds

