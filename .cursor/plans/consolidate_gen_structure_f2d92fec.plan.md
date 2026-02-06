---
name: Consolidate gen/ structure
overview: Fix broken codegen for workflow task types (AgentExecutionConfig, ForkBranch, etc.), eliminate duplicate workflow/gen/ directory, and establish a clean, buildable gen/ structure as foundation for the DDD reorganization.
todos:
  - id: fix-codegen-load-tasks-types
    content: Update loadSchemas() in main.go to load types from tasks/types/ directory
    status: completed
  - id: fix-task-config-imports
    content: Update generateTaskFile() to properly import and qualify shared types from gen/types
    status: completed
  - id: regenerate-all-code
    content: Run make codegen to regenerate all gen/ code with fixed codegen
    status: completed
  - id: delete-duplicate-workflow-gen
    content: Delete sdk/go/workflow/gen/ duplicate directory
    status: completed
  - id: update-gen-types-aliases
    content: Update workflow/gen_types.go with type aliases for workflow types
    status: completed
  - id: verify-build-passes
    content: Verify go build ./sdk/go/... and go test ./sdk/go/... pass
    status: completed
isProject: false
---

# Task 1.1: Consolidate gen/ Structure

## Problem Analysis

The SDK has **critical build failures** due to missing generated types and a confusing duplicate directory structure:

**Current Issues:**

1. **Missing Types** - Workflow task configs reference undefined types:
  - `AgentExecutionConfig`, `ForkBranch`, `HttpEndpoint`, `ListenTo`, `SwitchCase`, `CatchBlock`
2. **Duplicate Directories** - Two gen directories with similar broken code:
  - `sdk/go/gen/workflow/` (package `workflow`) - newer, 21 files
  - `sdk/go/workflow/gen/` (package `gen`) - older duplicate, 18 files
3. **Codegen Bug** - The generator at `[tools/codegen/generator/main.go](tools/codegen/generator/main.go)` doesn't load schemas from `tasks/types/`:
  - Schema files exist at `tools/codegen/schemas/tasks/types/*.json`
  - Codegen only looks at `{schemaDir}/types/` which doesn't exist
  - Task types are never generated into `gen/types/`

## Root Cause

In `main.go` lines 279-309, `loadSchemas()` looks for shared types at:

```go
typesDir := filepath.Join(g.schemaDir, "types")  // schemas/types/ - DOESN'T EXIST!
```

But the workflow task types are at `schemas/tasks/types/`, which is treated as a task subdirectory, not a types source.

## Solution Architecture

**Target Structure:**

```
sdk/go/gen/
├── agent/               # AgentArgs (keep as-is)
├── mcpserver/           # McpServerArgs (keep as-is)  
├── skill/               # SkillArgs (keep as-is)
├── workflow/            # Task configs (fix imports)
│   ├── agentcalltaskconfig.go
│   ├── forktaskconfig.go
│   └── ... (all task configs)
├── types/               # All shared types
│   ├── agentic_types.go    # Existing
│   ├── commons_types.go    # Existing
│   ├── iam_types.go        # Existing
│   └── workflow_types.go   # NEW - task-specific types
└── (delete workflow/gen/)
```

## Implementation Steps

### Step 1: Fix Codegen to Generate Workflow Task Types

Modify `[tools/codegen/generator/main.go](tools/codegen/generator/main.go)` `loadSchemas()` function to also load types from `tasks/types/`:

```go
// After loading from typesDir (around line 309), add:
tasksTypesDir := filepath.Join(g.schemaDir, "tasks", "types")
if _, err := os.Stat(tasksTypesDir); err == nil {
    // Load workflow task types from tasks/types/
    entries, err := os.ReadDir(tasksTypesDir)
    // ... similar loading logic
    // Mark these types with domain "workflow" 
}
```

Key changes:

- Add `tasks/types/` as a secondary types source
- Set domain to "workflow" for these types (so they go to `workflow_types.go`)
- Ensure task configs in `gen/workflow/` import from `gen/types`

### Step 2: Update Task Config Generation to Import Types

In `generateTaskFile()` (around line 620), ensure generated task configs properly import shared types:

```go
// When a field references a shared type (like AgentExecutionConfig),
// add import: "github.com/stigmer/stigmer/sdk/go/gen/types"
// Use qualified name: types.AgentExecutionConfig
```

### Step 3: Regenerate All Code

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer
rm -rf sdk/go/gen/workflow/*.go   # Clear stale workflow task configs
rm -rf sdk/go/gen/types/*.go      # Clear stale types
make codegen                       # Regenerate everything
```

### Step 4: Delete Duplicate Directory

```bash
rm -rf sdk/go/workflow/gen/       # Remove duplicate
```

### Step 5: Update Type Aliases

Modify `[sdk/go/workflow/gen_types.go](sdk/go/workflow/gen_types.go)` to re-export workflow task types from `gen/types`:

```go
import (
    genWorkflow "github.com/stigmer/stigmer/sdk/go/gen/workflow"
    "github.com/stigmer/stigmer/sdk/go/gen/types"
)

// Task config aliases (from gen/workflow)
type AgentCallTaskConfig = genWorkflow.AgentCallTaskConfig
// ...

// Type aliases for workflow types (from gen/types)
type (
    AgentExecutionConfig = types.AgentExecutionConfig
    ForkBranch          = types.ForkBranch
    HttpEndpoint        = types.HttpEndpoint
    // ...
)
```

### Step 6: Verify Build

```bash
cd sdk/go && go build ./gen/... && go test ./...
```

## Files to Modify


| File                                                                 | Action                                       |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `[tools/codegen/generator/main.go](tools/codegen/generator/main.go)` | Add `tasks/types/` loading, fix type imports |
| `[sdk/go/workflow/gen_types.go](sdk/go/workflow/gen_types.go)`       | Add type aliases for workflow types          |
| `sdk/go/workflow/gen/`                                               | DELETE entirely                              |
| `sdk/go/gen/workflow/*.go`                                           | REGENERATE                                   |
| `sdk/go/gen/types/*.go`                                              | REGENERATE with workflow_types.go            |


## Validation Criteria

1. `go build ./sdk/go/gen/...` succeeds (no undefined types)
2. `go build ./sdk/go/workflow/...` succeeds
3. `go build ./sdk/go/...` succeeds
4. `go test ./sdk/go/...` passes
5. No duplicate gen directories exist
6. `gen/types/workflow_types.go` contains AgentExecutionConfig, ForkBranch, etc.

## Risk Mitigation

- **Import path changes**: None for external consumers - `gen/types` path unchanged
- **Type aliases**: `workflow/gen_types.go` provides backward compatibility
- **Codegen changes**: Localized to type loading logic, doesn't affect existing generation

## Dependencies

- No external dependencies
- Foundation for all subsequent DDD reorganization tasks

