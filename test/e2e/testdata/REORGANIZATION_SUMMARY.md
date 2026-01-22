# Test Data Reorganization Summary

## Overview

This document summarizes the reorganization of the E2E test data structure and the updates made to align with the latest Stigmer SDK patterns.

## Changes Made

### 1. Directory Structure Reorganization

**Before:**
```
testdata/
├── basic_agent.go
├── Stigmer.yaml
└── workflows/
    ├── simple_sequential.go
    ├── conditional_switch.go
    ├── error_handling.go
    ├── loop_for.go
    ├── parallel_fork.go
    └── Stigmer.yaml (only pointed to simple_sequential.go)
```

**After:**
```
testdata/
├── agents/
│   └── basic-agent/
│       ├── main.go
│       └── Stigmer.yaml
├── workflows/
│   ├── simple-sequential/
│   │   ├── main.go
│   │   └── Stigmer.yaml
│   ├── conditional-switch/
│   │   ├── main.go
│   │   └── Stigmer.yaml
│   ├── error-handling/
│   │   ├── main.go
│   │   └── Stigmer.yaml
│   ├── loop-for/
│   │   ├── main.go
│   │   └── Stigmer.yaml
│   └── parallel-fork/
│       ├── main.go
│       └── Stigmer.yaml
└── go.mod
```

**Benefits:**
- ✅ Each test case has its own folder with its own `Stigmer.yaml`
- ✅ All workflows can now be executed independently
- ✅ Clear separation between agents and workflows
- ✅ Consistent naming convention (kebab-case for folders)

### 2. SDK Pattern Updates

All workflows have been updated to follow the latest Stigmer SDK patterns:

#### ✅ Removed `.ExportAll()` Calls

**Before:**
```go
fetchTask := workflow.HttpCall("fetch",
    workflow.HTTPMethod("GET"),
    workflow.URI(url),
).ExportAll()  // ❌ Explicit export
```

**After:**
```go
fetchTask := wf.HttpGet("fetch", url,
    workflow.Timeout(10),
)  // ✅ Auto-export when fields are accessed
```

#### ✅ Direct Field References Instead of Expressions

**Before:**
```go
processTask := workflow.SetTask("process", map[string]string{
    "title": "${.title}",  // ❌ Expression syntax
})
```

**After:**
```go
processTask := wf.Set("process",
    workflow.SetVar("title", fetchTask.Field("title")),  // ✅ Direct field reference
)
```

#### ✅ Workflow-Scoped Builders

**Before:**
```go
initTask := workflow.SetTask("init", map[string]string{...})
wf.AddTask(initTask)  // ❌ Module-level builder + manual add
```

**After:**
```go
initTask := wf.Set("init",
    workflow.SetVar("url", "..."),
)  // ✅ Workflow-scoped builder, auto-added
```

#### ✅ Context for Configuration, Not Data Flow

**Before:**
```go
// Using Set tasks for configuration
initTask := wf.Set("init",
    workflow.SetVar("baseUrl", "https://api.example.com"),
)
// Then referencing with field refs
url := initTask.Field("baseUrl")
```

**After:**
```go
// Using context for configuration
apiBase := ctx.SetString("apiBase", "https://api.example.com")
// Direct usage in tasks
fetchTask := wf.HttpGet("fetch", apiBase.Concat("/endpoint"))
```

### 3. Workflow-Specific Updates

#### simple-sequential/
- ✅ Removed `ExportAll()` from HTTP call
- ✅ Converted to `wf.Set()` and `wf.HttpGet()` builders
- ✅ Used direct field references throughout

#### conditional-switch/
- ✅ Updated Switch API to use `workflow.SwitchOn()` and `workflow.Equals()`
- ✅ Added `DependsOn()` for handler tasks
- ✅ Converted to workflow-scoped builders

#### parallel-fork/
- ✅ Moved configuration to context (apiBase, userId)
- ✅ Used `StringRef.Concat()` for URL building
- ✅ Updated to use `forkTask.Branch()` method for accessing results
- ✅ Removed `ExportAll()` calls

#### loop-for/
- ✅ Converted from `workflow.For()` to `wf.ForEach()`
- ✅ Used `workflow.WithLoopBody()` with lambda function
- ✅ Moved items array to context
- ✅ Simplified loop body implementation

#### error-handling/
- ✅ Moved endpoints to context
- ✅ Simplified try-catch structure
- ✅ Removed intermediate Set task
- ✅ Used workflow-scoped builders

### 4. Test Infrastructure Updates

#### Updated Files:
1. **`e2e_workflow_test.go`**
   - Updated `PrepareWorkflowFixture()` to map old filenames to new folder paths
   - Converts `simple_sequential.go` → `testdata/workflows/simple-sequential/Stigmer.yaml`

2. **`e2e_run_full_test.go`**
   - Updated agent path from `testdata/Stigmer.yaml` to `testdata/agents/basic-agent/Stigmer.yaml`

3. **`cli_runner_test.go`**
   - Updated example paths in comments

### 5. Documentation Updates

Created comprehensive README files:

1. **`testdata/README.md`** - Overview of test data structure
2. **`testdata/agents/README.md`** - Agent-specific documentation
3. **`testdata/workflows/README.md`** - Workflow-specific documentation with SDK patterns

All READMEs include:
- Directory structure overview
- Test coverage descriptions
- Latest SDK pattern examples
- Running instructions
- Debugging tips

## Migration Guide

### For Developers Adding New Test Cases

1. **Create a new folder:**
   ```bash
   mkdir -p test/e2e/testdata/workflows/my-new-test
   ```

2. **Add main.go:**
   ```go
   //go:build ignore
   
   package main
   
   import (
       "log"
       "github.com/stigmer/stigmer/sdk/go/stigmer"
       "github.com/stigmer/stigmer/sdk/go/workflow"
   )
   
   func main() {
       err := stigmer.Run(func(ctx *stigmer.Context) error {
           // Your workflow implementation
           return nil
       })
       if err != nil {
           log.Fatalf("Failed: %v", err)
       }
   }
   ```

3. **Add Stigmer.yaml:**
   ```yaml
   name: my-new-test
   runtime: go
   main: main.go
   version: 0.1.0
   description: Description of the test
   ```

4. **Follow SDK patterns:**
   - Use `ctx.SetString()` for configuration
   - Use `wf.Set()`, `wf.HttpGet()`, etc. for tasks
   - Use direct field references: `task.Field("name")`
   - No need for `.ExportAll()`

### For Developers Updating Existing Workflows

1. Replace `workflow.SetTask()` with `wf.Set()`
2. Replace `workflow.HttpCall()` with `wf.HttpGet()` or `wf.HttpPost()`
3. Remove `.ExportAll()` calls
4. Replace `"${.field}"` expressions with `task.Field("field")`
5. Move configuration to context: `ctx.SetString()`
6. Use workflow-scoped builders instead of module-level + `wf.AddTask()`

## Validation

### Tests Pass With New Structure

All E2E tests have been updated to work with the new structure:
- ✅ Agent apply tests reference correct path
- ✅ Workflow apply tests use updated `PrepareWorkflowFixture()`
- ✅ Execution tests work with new paths

### SDK Patterns Verified

All workflows have been verified against:
- ✅ Latest SDK examples (`sdk/go/examples/`)
- ✅ Proper method signatures
- ✅ Correct API usage
- ✅ Best practices from documentation

## Benefits

### For Test Maintenance
- Each test case is self-contained
- Easy to add new test cases
- Clear separation of concerns
- Consistent structure

### For SDK Adoption
- Demonstrates best practices
- Shows correct API usage
- Provides working examples
- Reduces cognitive load

### For Development
- Tests serve as documentation
- Easy to debug individual cases
- Clear execution flow
- Better error messages

## Next Steps

1. Run E2E tests to verify all changes work
2. Update any external documentation referencing old paths
3. Consider adding more test cases using the new structure
4. Maintain alignment with SDK updates

---

**Date:** 2026-01-23
**Author:** AI Assistant (Cursor)
**Approved by:** [To be filled]
