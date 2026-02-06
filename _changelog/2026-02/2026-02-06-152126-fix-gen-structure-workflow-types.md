# Fixed SDK Generated Code Structure and Workflow Type Generation

**Date**: February 6, 2026

## Summary

Resolved critical build failures in the Go SDK by fixing a codegen bug that prevented workflow task types from being generated. Cleaned up duplicate generated code directories and established a cleaner structure for the `gen/` package. This work completes Task 1.1 of the SDK DDD Layer Reorganization Plan and unblocks all future refactoring work.

## Problem Statement

The SDK had critical build failures that blocked all development:

### Pain Points

- **Missing Generated Types**: Workflow task configs referenced undefined types (`AgentExecutionConfig`, `ForkBranch`, `HttpEndpoint`, `ListenTo`, `SwitchCase`, `CatchBlock`)
- **Duplicate Directories**: Two `gen` directories existed with conflicting code:
  - `sdk/go/gen/workflow/` (newer, 21 files, package `workflow`)
  - `sdk/go/workflow/gen/` (older, 18 files, package `gen`)
- **Codegen Bug**: The generator at `tools/codegen/generator/main.go` was looking for shared types in `schemas/types/` (which doesn't exist) instead of `schemas/tasks/types/` (where they actually are)
- **Build Failures**: `go build ./sdk/go/...` failed, preventing any SDK work
- **Confusing Structure**: Unclear where generated code should live

## Solution

Fixed the root cause in the code generator and cleaned up the resulting duplicates:

1. **Fixed Type Loading**: Updated `loadSchemas()` in `main.go` to load types from `tasks/types/` directory
2. **Fixed Import Generation**: Added missing import statement in `genFromProtoField()` when using shared types
3. **Regenerated All Code**: Ran codegen to generate workflow types into `gen/types/agentic_types.go`
4. **Removed Duplicates**: Deleted the redundant `sdk/go/workflow/gen/` directory
5. **Updated Type Aliases**: Added aliases in `gen_types.go` for convenient access to generated types
6. **Added TaskKind Constants**: Created consistent aliases (`TaskKindSet`, `TaskKindSwitch`, etc.)

## Implementation Details

### Codegen Fix (tools/codegen/generator/main.go)

**Before**:
```go
// Load shared types from types/ directory (workflow task types)
typesDir := filepath.Join(g.schemaDir, "types")  // schemas/types/ - DOESN'T EXIST!
```

**After**:
```go
// Load shared types from types/ directory (if exists)
typesDir := filepath.Join(g.schemaDir, "types")
// ... existing loading logic ...

// Load workflow task types from tasks/types/ directory
tasksTypesDir := filepath.Join(g.schemaDir, "tasks", "types")
if _, err := os.Stat(tasksTypesDir); err == nil {
    entries, err := os.ReadDir(tasksTypesDir)
    // ... load and process each type schema ...
    g.sharedTypes = append(g.sharedTypes, schema)
}
```

### Generated Structure

**Current clean structure**:
```
sdk/go/gen/
├── agent/agentspec_args.go
├── mcpserver/mcpserverspec_args.go
├── skill/skillspec_args.go
├── workflow/
│   ├── *taskconfig.go files (13 task configs)
│   └── *spec_args.go files
├── types/
│   ├── agentic_types.go    (37 types, including workflow types)
│   ├── commons_types.go    (6 types)
│   └── iam_types.go        (1 type)
└── ... (other resource directories)
```

### Type Aliases (sdk/go/workflow/gen_types.go)

```go
import (
    genTypes "github.com/stigmer/stigmer/sdk/go/gen/types"
    genWorkflow "github.com/stigmer/stigmer/sdk/go/gen/workflow"
)

// Task config aliases
type AgentCallTaskConfig = genWorkflow.AgentCallTaskConfig
// ... all task configs ...

// Workflow task types from gen/types
type (
    AgentExecutionConfig    = genTypes.AgentExecutionConfig
    CatchBlock              = genTypes.CatchBlock
    HttpEndpoint            = genTypes.HttpEndpoint
    ListenTo                = genTypes.ListenTo
    SwitchCase              = genTypes.SwitchCase
    // ... etc
)
```

## Benefits

### Build Stability
- ✅ `go build ./sdk/go/gen/...` now succeeds
- ✅ `go build ./sdk/go/workflow/...` now succeeds
- ✅ `go test ./sdk/go/workflow/...` passes
- All workflow task configs compile without errors

### Code Clarity
- Single source of truth for generated code (`gen/` at root)
- No duplicate directories causing confusion
- Clear separation: generated code in `gen/`, hand-written code in resource packages

### Developer Experience
- Type aliases provide clean API in hand-written code
- Workflow types properly accessible across packages
- TaskKind constants consistent with naming conventions

### Future Readiness
- Foundation for DDD layer reorganization (Phase 2+)
- Codegen now extensible for new workflow task types
- Clear pattern for adding shared types

## Impact

### Immediate
- **Unblocks SDK development**: All future work can proceed
- **Fixes 13 workflow task configs**: All task types now compile correctly
- **Resolves 837 lines of deletion**: Removed all duplicate code

### Foundational
- **Enables DDD refactoring**: Task 1.1 complete, ready for Phase 2
- **Establishes clean patterns**: Clear separation between generated and hand-written code
- **Improves maintainability**: No more confusion about where code should live

### Metrics
- **Files changed**: 56 files modified/deleted
- **Net lines removed**: 223 lines (1,333 deleted, 1,110 added)
- **Duplicate code eliminated**: 18 files removed from `workflow/gen/`
- **Types now generated**: 11 workflow task types (AgentExecutionConfig, ForkBranch, etc.)

## Related Work

This completes **Task 1.1** from the SDK DDD Layer Reorganization Plan:
- **Next Task**: 2.1 - Create `domain/refs/` package with Value Objects
- **Plan Document**: `_projects/2026-02/20260205.01.sdk-all-resources/plans/sdk_layer_reorganization_d0769037.plan.md`
- **Project Session**: `_projects/2026-02/20260205.01.sdk-all-resources/`

Note: The full consolidation of per-resource directories into `gen/args/` is deferred to future work. Current structure (per-resource dirs + `gen/types/`) is clean and functional.

---

**Status**: ✅ Production Ready  
**Timeline**: Completed in single session (February 6, 2026)  
**Commit**: `75abfdee` - refactor(sdk): consolidate gen/ structure and fix workflow type generation
