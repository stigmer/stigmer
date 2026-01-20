# Fix Workflow-Runner Module Dependencies

**Date**: 2026-01-20  
**Scope**: `backend/services/workflow-runner`  
**Type**: `fix`

## Problem

The `workflow-runner` service had incorrect Go module configuration causing compilation failures:

1. **Wrong module path**: Used `github.com/leftbin/stigmer-cloud/backend/services/workflow-runner` instead of `github.com/stigmer/stigmer/backend/services/workflow-runner`
2. **Wrong replace directive**: Pointed to `stigmer-cloud` APIs instead of `stigmer` APIs
3. **Mismatched imports**: All 21+ files imported from wrong module path
4. **Test failures**: All packages failed with "no required module provides package" errors

The root cause was that `workflow-runner` was copied from `stigmer-cloud` repo but the module paths weren't updated to match the `stigmer` repo structure.

## What Changed

### Module Configuration

**File**: `backend/services/workflow-runner/go.mod`

Changed module declaration:
```diff
- module github.com/leftbin/stigmer-cloud/backend/services/workflow-runner
+ module github.com/stigmer/stigmer/backend/services/workflow-runner
```

Updated replace directive for proto stubs:
```diff
- replace github.com/leftbin/stigmer-cloud/apis/stubs/go => ../../../apis/stubs/go
+ replace github.com/stigmer/stigmer/apis/stubs/go => ../../../apis/stubs/go
```

Updated proto stubs dependency:
```diff
- github.com/leftbin/stigmer-cloud/apis/stubs/go v0.0.0-00010101000000-000000000000
+ github.com/stigmer/stigmer/apis/stubs/go v0.0.0-00010101000000-000000000000
```

### Import Statement Updates

Updated imports in 21 files across workflow-runner:

**Proto stub imports** (external APIs):
```diff
- github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/...
+ github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/...
```

**Internal package imports** (within workflow-runner):
```diff
- github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/...
+ github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/...
```

**Files updated**:
- `pkg/validation/*.go` (4 files)
- `pkg/grpc_client/*.go` (3 files)
- `pkg/executor/*.go` (1 file)
- `pkg/zigflow/tasks/*.go` (2 files)
- `pkg/workflows/*.go` (1 file)
- `pkg/grpc/*.go` (1 file)
- `pkg/converter/*.go` (4 files)
- `pkg/interceptors/*.go` (1 file)
- `worker/activities/*.go` (3 files)

### Code Fixes

**1. Linter Error - `pkg/temporal/searchattributes/setup.go:218`**

Fixed non-constant format string in `fmt.Errorf`:
```diff
- return fmt.Errorf(errMsg)
+ return fmt.Errorf("%s", errMsg)
```

**2. Test Error - `worker/activities/validate_workflow_activity_test.go`**

Fixed undefined enum constant:
```diff
- import tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
+ import "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"

- Kind: tasksv1.WorkflowTaskKind_SET,
+ Kind: apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET,
```

The `WorkflowTaskKind` enum is in `commons/apiresource`, not in the `tasks` package.

## Impact

**Before**: All workflow-runner tests failed with module dependency errors:
```
# github.com/leftbin/stigmer-cloud/backend/services/workflow-runner
../../../apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1/spec.pb.go:10:2: 
  no required module provides package github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1
```

**After**: Compilation succeeds, tests run:
- ✅ All packages compile successfully
- ✅ `claimcheck` - 17 tests PASSED
- ✅ `utils` - 4 tests PASSED
- ✅ `zigflow/metadata` - 2 tests PASSED
- ✅ `test/golden` - All 12 golden workflows PASSED
- ⚠️ `worker/activities` - 1 test failing (unrelated Temporal test setup issue)

## Technical Context

### Module Organization in Stigmer Monorepo

The `stigmer` OSS repo has this module structure:

```
github.com/stigmer/stigmer/
├── apis/stubs/go/           # Proto-generated stubs (separate module)
│   └── go.mod               # module: github.com/stigmer/stigmer/apis/stubs/go
├── backend/services/
│   └── workflow-runner/     # Workflow execution service
│       └── go.mod           # module: github.com/stigmer/stigmer/backend/services/workflow-runner
│                            # replace: github.com/stigmer/stigmer/apis/stubs/go => ../../../apis/stubs/go
└── go.mod                   # Root module: github.com/stigmer/stigmer
```

**Key Pattern**: Each service with its own `go.mod` must:
1. Use the correct module path matching the repo
2. Use `replace` directive to point to local proto stubs
3. Import from the correct module path in all files

### Why This Happened

The `workflow-runner` was originally developed in `stigmer-cloud` repo (closed-source) and was migrated to `stigmer` repo (open-source). During migration:
- Code files were copied
- `go.mod` wasn't fully updated
- Import paths weren't updated
- Tests weren't run to verify module configuration

This is a common migration issue when moving code between repos with different module paths.

## Dependencies

Ran `go mod tidy` to update dependencies after fixing module paths. No external dependency changes needed - only internal module path corrections.

## Testing

**Verification steps**:
1. Fixed all module path issues
2. Ran `go mod tidy` to verify dependency resolution
3. Ran `make test-workflow-runner` to verify compilation and tests
4. All packages compile without errors
5. Test suites execute (one unrelated test failure in Temporal activity setup)

**Remaining work**:
- Fix `TestGenerateYAMLActivity_Success` - needs Temporal test environment setup (separate issue, not related to module dependencies)

## Lessons Learned

1. **Module path consistency is critical** - When migrating code between repos, module paths must be updated everywhere
2. **Proto stub organization** - Proto stubs are in separate module with replace directive
3. **Import path patterns** - Both external (proto APIs) and internal (service packages) imports need updating
4. **Enum locations** - Task kind enums are in `commons/apiresource`, not in task-specific packages
5. **Test early** - Run tests immediately after migration to catch module configuration issues

## Files Changed

- `backend/services/workflow-runner/go.mod` - Module path and replace directive corrections
- 21 `.go` files - Import statement updates across workflow-runner
- `backend/services/workflow-runner/pkg/temporal/searchattributes/setup.go` - Linter fix
- `backend/services/workflow-runner/worker/activities/validate_workflow_activity_test.go` - Enum constant fix
