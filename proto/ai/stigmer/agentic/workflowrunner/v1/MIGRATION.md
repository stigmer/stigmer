# Workflow Runner Restructuring

## Summary

Moved workflow runner from nested structure to first-class package following Stigmer API resource conventions.

## Changes Made

### 1. Directory Structure

**Before:**
```
apis/ai/stigmer/agentic/workflow/runner/v1/
├── BUILD.bazel
├── command.proto
├── io.proto
└── README.md
```

**After:**
```
apis/ai/stigmer/agentic/workflowrunner/v1/
├── BUILD.bazel
├── service.proto   (renamed from command.proto)
├── io.proto
└── README.md
```

### 2. Package Name

**Before:**
```protobuf
package ai.stigmer.agentic.workflow.runner.v1;
```

**After:**
```protobuf
package ai.stigmer.agentic.workflowrunner.v1;
```

### 3. Service Name

**Before:**
```protobuf
service WorkflowRunnerCommandController {
  // ...
}
```

**After:**
```protobuf
service WorkflowExecutionService {
  // ...
}
```

### 4. File Organization

| Purpose | Before | After |
|---------|--------|-------|
| Service interface | `command.proto` | `service.proto` |
| I/O messages | `io.proto` | `io.proto` (same) |
| Build config | `BUILD.bazel` | `BUILD.bazel` (updated) |

## Rationale

### 1. Consistent Pattern

**Before (inconsistent):**
- All resources: `{name}/v1/` (agent, workflow, agentexecution, etc.)
- Workflow runner: `workflow/runner/v1/` ❌ (nested anti-pattern)

**After (consistent):**
- All packages: `{name}/v1/` ✅
- Workflow runner: `workflowrunner/v1/` ✅

### 2. First-Class Package

The workflow runner is treated as a first-class package, not a sub-package of workflow:
- Will eventually have its own API resource (`WorkflowRunner`)
- Will have CRUD operations (`WorkflowRunnerCommandController`)
- Currently contains service interface (`WorkflowExecutionService`)

### 3. Clear Naming

**Service naming distinction:**

| Name | Purpose | Location |
|------|---------|----------|
| `WorkflowRunner` | API resource (future) | `api.proto` (future) |
| `WorkflowRunnerCommandController` | CRUD operations (future) | `command.proto` (future) |
| `WorkflowExecutionService` | Service interface for runners | `service.proto` (current) |

The name `WorkflowExecutionService` clearly indicates:
- It's the service that **executes** workflows
- It's implemented by workflow runners
- It's distinct from resource management operations

## Import Updates Required

Any code importing the old package must be updated:

**Old imports:**
```go
import workflowrunner "github.com/leftbin/stigmer-cloud/apis/ai/stigmer/workflow/runner/v1"
```

**New imports:**
```go
import workflowrunner "github.com/leftbin/stigmer-cloud/apis/ai/stigmer/agentic/workflowrunner/v1"
```

**Service references:**
```go
// Before
workflowrunner.WorkflowRunnerCommandControllerClient

// After
workflowrunner.WorkflowExecutionServiceClient
```

## Future Additions

When workflow runner registration is implemented, this package will also contain:

```
apis/ai/stigmer/agentic/workflowrunner/v1/
├── api.proto              (WorkflowRunner resource)
├── command.proto          (WorkflowRunnerCommandController - CRUD)
├── query.proto            (WorkflowRunnerQueryController - read ops)
├── io.proto              (I/O messages)
├── spec.proto            (WorkflowRunnerSpec)
├── service.proto         (WorkflowExecutionService interface) ✅ exists
├── BUILD.bazel
└── README.md
```

## Migration Checklist

- [x] Create new `workflowrunner/v1/` directory
- [x] Move and update `io.proto` with new package name
- [x] Rename `command.proto` to `service.proto`
- [x] Rename service to `WorkflowExecutionService`
- [x] Update BUILD.bazel with new target names
- [x] Update README with new structure
- [x] Delete old `workflow/runner/` directory
- [ ] Update any imports in backend code (if any)
- [ ] Update any references in documentation
- [ ] Update Bazel dependencies referencing old path

## Benefits

✅ **Consistent** - Follows the `{name}/v1/` pattern used by all other packages
✅ **Clear** - Service name `WorkflowExecutionService` clearly describes purpose
✅ **Scalable** - Room for future API resource and CRUD operations
✅ **Maintainable** - Easier to find and understand as a first-class package
✅ **Professional** - No nested anti-patterns in the API structure
