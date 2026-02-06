---
name: Workflow Package Simplification
overview: Simplify the workflow package from 38 files to 16 files by consolidating task factories, helpers, errors, and tests while moving documentation to the docs folder.
todos:
  - id: move-docs
    content: Move README.md and BRACKET_NOTATION.md to docs/sdk/workflow/, delete obsolete docs
    status: completed
  - id: create-expression
    content: Create expression.go by merging helpers.go and ref_helpers.go
    status: completed
  - id: create-tasks-simple
    content: Create tasks_simple.go by merging 8 simple task factory files
    status: completed
  - id: rename-tasks-http
    content: Rename httpcall_options.go to tasks_http.go
    status: completed
  - id: create-tasks-control
    content: Create tasks_control.go by merging for, fork, switch, try options and helpers
    status: completed
  - id: expand-errors
    content: Expand errors.go by merging error_types.go and error_matcher.go
    status: completed
  - id: delete-agent-ref
    content: Delete agent_ref.go (not needed - users can use strings directly)
    status: completed
  - id: consolidate-tests
    content: Merge proto_integration, edge_cases, error_cases tests into workflow_test.go
    status: completed
  - id: cleanup-files
    content: Delete all original merged files
    status: completed
  - id: verify-build
    content: Run go build, go test, go vet to verify all changes
    status: completed
isProject: false
---

# Workflow Package Simplification

## Current Problem

The workflow package has **38 files** - excessive fragmentation that increases cognitive load:

- 12 separate `*_options.go` files (many just 20-30 lines)
- 4 scattered helper files
- 3 error-related files
- 5 documentation files that don't belong in package

## Target State

**38 files → 16 files (-58%)**

## File Consolidation Strategy

### 1. Create `tasks_simple.go` (merge 8 files)

Merge these trivially small files into one:

- `agentcall_options.go` (38 lines)
- `callactivity_options.go` (30 lines)
- `grpccall_options.go` (32 lines)
- `listen_options.go` (25 lines)
- `raise_options.go` (25 lines)
- `run_options.go` (30 lines)
- `set_options.go` (34 lines)
- `wait_options.go` (25 lines)

Structure:

```go
// tasks_simple.go - Simple task factory functions
package workflow

// Type aliases
type (
    SetArgs          = SetTaskConfig
    WaitArgs         = WaitTaskConfig
    ListenArgs       = ListenTaskConfig
    RaiseArgs        = RaiseTaskConfig
    RunArgs          = RunTaskConfig
    GrpcCallArgs     = GrpcCallTaskConfig
    CallActivityArgs = CallActivityTaskConfig
    AgentCallArgs    = AgentCallTaskConfig
)

// Factory functions: Set(), Wait(), Listen(), Raise(), Run(), GrpcCall(), CallActivity(), AgentCall()
```

### 2. Rename `httpcall_options.go` → `tasks_http.go`

Keep separate - has substantial content (117 lines):

- HttpCallArgs alias
- HttpCall() factory
- HttpGet(), HttpPost(), HttpPut(), HttpPatch(), HttpDelete() convenience methods

### 3. Create `tasks_control.go` (merge 4 files + 2 helpers)

Merge control flow tasks with their helpers:

- `for_options.go` (171 lines) - ForArgs, For(), LoopVar, LoopBody
- `fork_options.go` (89 lines) - ForkArgs, Fork(), BranchDef, BranchResult
- `fork_helpers.go` (40 lines) - ForkBranch(), ForkBranches()
- `switch_options.go` (125 lines) - SwitchArgs, Switch(), ConditionMatcher
- `try_options.go` (102 lines) - TryArgs, Try(), ErrorRef
- `try_helpers.go` (64 lines) - TryBody(), CatchBody()

### 4. Create `expression.go` (merge 2 files)

Consolidate expression helpers:

- `helpers.go` (51 lines) - IsEmpty(), CoerceToString()
- `ref_helpers.go` (156 lines) - Ref interface, toExpression(), toInt32(), toBool()

### 5. Expand `errors.go` (merge 3 files)

Consolidate all error code:

- `errors.go` (126 lines) - Sentinel errors, validation wrappers
- `error_types.go` (285 lines) - ErrorTypeHTTPCall, ErrorRegistry, etc.
- `error_matcher.go` (206 lines) - ErrorMatcher, CatchHTTPErrors(), etc.

### 6. Delete `agent_ref.go`

Not needed - `AgentCallTaskConfig.Agent` is just a string. Users can use:

- Direct string: `Agent: "org/slug"`
- From agent instance: `Agent: myAgent.Org + "/" + myAgent.Slug`

### 7. Move Documentation


| Current Location                         | New Location                            |
| ---------------------------------------- | --------------------------------------- |
| `workflow/README.md`                     | `docs/sdk/workflow/README.md`           |
| `workflow/BRACKET_NOTATION.md`           | `docs/sdk/workflow/bracket-notation.md` |
| `workflow/CHANGELOG_BRACKET_NOTATION.md` | Delete (git history)                    |
| `workflow/ADVANCED_FEATURES_TODO.md`     | Delete (use GitHub issues)              |
| `workflow/ERROR_TYPES_README.md`         | Merge into errors.go comments           |


### 8. Consolidate Tests


| Current Files                                                              | New File                          |
| -------------------------------------------------------------------------- | --------------------------------- |
| `proto_integration_test.go` + `edge_cases_test.go` + `error_cases_test.go` | `workflow_test.go`                |
| `for_loop_test.go`                                                         | Rename to `tasks_control_test.go` |
| `benchmarks_test.go`                                                       | Keep separate                     |
| `task_field_ref_test.go`                                                   | Keep separate                     |


## Final File Structure

```
sdk/go/workflow/
├── workflow.go           # Main Workflow struct (unchanged)
├── task.go               # Task struct, TaskFieldRef (unchanged)
├── proto.go              # ToProto conversion (unchanged)
├── validation.go         # Validation logic (unchanged)
├── gen_types.go          # Generated type aliases (unchanged)
├── doc.go                # Package documentation (unchanged)
├── runtime_env.go        # RuntimeSecret, RuntimeEnv (unchanged)
├── tasks_simple.go       # NEW: 8 simple task factories merged
├── tasks_http.go         # RENAMED: from httpcall_options.go
├── tasks_control.go      # NEW: 4 control tasks + helpers merged
├── expression.go         # NEW: 2 helper files merged
├── errors.go             # EXPANDED: 3 error files merged
├── workflow_test.go      # NEW: 3 test files merged
├── benchmarks_test.go    # Unchanged
├── task_field_ref_test.go # Unchanged
└── tasks_control_test.go # RENAMED: from for_loop_test.go
```

## Files Deleted (22 files)

Task options (8):

- `agentcall_options.go`, `callactivity_options.go`, `grpccall_options.go`
- `listen_options.go`, `raise_options.go`, `run_options.go`
- `set_options.go`, `wait_options.go`

Control flow (6):

- `for_options.go`, `fork_options.go`, `fork_helpers.go`
- `switch_options.go`, `try_options.go`, `try_helpers.go`

Helpers (2):

- `helpers.go`, `ref_helpers.go`

Errors (2):

- `error_types.go`, `error_matcher.go`

Other (1):

- `agent_ref.go`

Documentation (5):

- `README.md`, `BRACKET_NOTATION.md`, `CHANGELOG_BRACKET_NOTATION.md`
- `ADVANCED_FEATURES_TODO.md`, `ERROR_TYPES_README.md`

Tests (3):

- `proto_integration_test.go`, `edge_cases_test.go`, `error_cases_test.go`
- `for_loop_test.go` (renamed)

## Execution Order

1. Create docs folder structure and move documentation
2. Create `expression.go` (merge helpers)
3. Create `tasks_simple.go` (merge 8 simple task files)
4. Rename `httpcall_options.go` → `tasks_http.go`
5. Create `tasks_control.go` (merge control flow files)
6. Expand `errors.go` (merge error files)
7. Delete `agent_ref.go`
8. Consolidate tests into `workflow_test.go`
9. Delete original merged files
10. Run `go build ./workflow/...` and `go test ./workflow/...`
11. Fix any issues

## Quality Gates

After each consolidation step:

```bash
cd sdk/go
go build ./workflow/...
go test ./workflow/...
go vet ./workflow/...
```

## Benefits

- **Reduced cognitive load**: 16 files vs 38 files
- **Easier navigation**: Related code in same file
- **Cleaner package**: No documentation clutter
- **Consistent patterns**: All simple tasks in one place, all control flow in another

