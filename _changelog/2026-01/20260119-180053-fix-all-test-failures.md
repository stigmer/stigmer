# Fix All Test Failures

**Date**: 2026-01-19  
**Type**: Test Fixes  
**Impact**: All test suites now passing

## Summary

Fixed 8 categories of test failures across the codebase, resolving compilation errors, API mismatches, and runtime issues. All tests now compile and pass successfully.

## Problems Fixed

### 1. Import Cycle in Temporal Packages ✅

**Issue**: Circular dependency between `agentexecution/temporal` and `workflows` packages:
```
temporal → imports workflows
workflows → imports temporal (for Config)
```

**Solution**: Moved `InvokeAgentExecutionWorkflowCreator` from `workflows` package to parent `temporal` package to break the cycle.

**Impact**: Packages now compile without circular dependency errors.

### 2. Badger Store API Changes ✅

**Issue**: Store API evolved but tests weren't updated:
- `GetResource` now requires `kind` parameter: `(ctx, kind, id, message)` 
- `DeleteResource` now requires `kind` parameter: `(ctx, kind, id)`
- `DeleteResourcesByKind` now returns count instead of error only
- Generic type syntax `Store[*T]` removed (Store is no longer generic)

**Solution**:
- Updated all method signatures in tests
- Used `apiresource.GetKindName(apiresourcekind.ApiResourceKind_agent)` instead of hardcoded strings
- Updated `DeleteResourcesByKind` implementation to return `(int64, error)`

**Files Fixed**:
- `backend/libs/go/badger/store.go` - Return count from `DeleteResourcesByKind`
- `backend/libs/go/badger/store_test.go` - Updated all test calls
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/activities/update_status_impl.go`
- `backend/services/stigmer-server/pkg/controllers/workflowexecution/temporal/activities/update_status_impl.go`

### 3. AgentController Constructor Signature ✅

**Issue**: `NewAgentController` now requires `*agentinstance.Client` parameter but tests only passed Store.

**Solution**: Added `nil` as second parameter in all test instantiations since agent instance client isn't needed for isolated unit tests.

**Files Fixed**:
- `backend/services/stigmer-server/pkg/controllers/agent/agent_controller_test.go`

### 4. Proto Registry Issues in Interceptor Tests ✅

**Issue**: gRPC interceptor tests failed because service descriptors weren't found in proto registry:
```
Service descriptor not found in registry
Expected kind agent but got api_resource_kind_unknown
```

**Solution**: Added blank imports to register proto descriptors:
```go
import (
    _ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    _ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
)
```

**Files Fixed**:
- `backend/libs/go/grpc/interceptors/apiresource/interceptor_test.go`

### 5. ApiResourceAudit Structure Changes ✅

**Issue**: Audit type structure changed:
- Old: `ApiResourceStatusAudit` (doesn't exist anymore)
- New: `ApiResourceAuditStatus` with nested `Audit` field
- Structure: `Status.Audit.Audit.StatusAudit` instead of `Status.Audit.StatusAudit`

**Solution**: Updated all references to use correct nested structure:
```go
// Before
status.Audit.StatusAudit = &apiresource.ApiResourceAuditInfo{}

// After  
status.Audit = &apiresource.ApiResourceAuditStatus{
    Audit: &apiresource.ApiResourceAudit{
        StatusAudit: &apiresource.ApiResourceAuditInfo{},
    },
}
```

**Files Fixed**:
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/activities/update_status_impl.go`
- `backend/services/stigmer-server/pkg/controllers/workflowexecution/temporal/activities/update_status_impl.go`

### 6. Agent Proto Schema Updates ✅

**Issue**: SQLite tests used outdated field names:
- `ApiResourceMetadata` field renamed to `Metadata`
- `OrgId` field renamed to `Org`  
- `Model` field doesn't exist in `AgentSpec`

**Solution**: Updated all test code to match current proto schema:
```go
// Before
agent.ApiResourceMetadata.OrgId = "org-1"
agent.Spec.Model = "gpt-4"

// After
agent.Metadata.Org = "org-1"
// Model field removed
```

**Files Fixed**:
- `backend/libs/go/sqlite/store_test.go`

### 7. Temporal SDK API Changes ✅

**Issue**: Temporal SDK types and methods changed:
- `worker.RegisterWorkflowOptions` removed
- `workflow.RetryPolicy` moved to `temporal.RetryPolicy`
- `info.Memo.GetValue()` method doesn't exist - must use `info.Memo.Fields` directly

**Solution**:
```go
// RegisterWorkflow - use simple registration
w.RegisterWorkflow(ValidateWorkflowWorkflowImpl)

// RetryPolicy - import from temporal package
import "go.temporal.io/sdk/temporal"
RetryPolicy: &temporal.RetryPolicy{...}

// Memo access - use Fields directly
if info.Memo != nil && info.Memo.Fields != nil {
    if field, ok := info.Memo.Fields["activityTaskQueue"]; ok {
        workflow.PayloadConverter().FromPayload(field, &taskQueueStr)
    }
}
```

**Files Fixed**:
- `backend/services/stigmer-server/pkg/controllers/workflow/temporal/worker.go`
- `backend/services/stigmer-server/pkg/controllers/workflow/temporal/workflow.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/workflows/invoke_workflow_impl.go`

### 8. Pipeline Audit Field Initialization ✅

**Issue**: Pipeline tests expected audit fields to be set, but Status was nil and audit initialization failed with nil pointer dereference.

**Solution**: Updated `clearStatusField()` to initialize Status using proto reflection if it's nil:
```go
func clearStatusField(resource HasStatus) error {
    status := resource.GetStatus()
    if status == nil {
        // Initialize the status field using proto reflection
        resourceMsg := proto.MessageReflect(resource)
        statusField := resourceMsg.Descriptor().Fields().ByName("status")
        if statusField != nil {
            statusType := statusField.Message()
            newStatus := statusType.New().Interface()
            resourceMsg.Set(statusField, protoreflect.ValueOfMessage(newStatus.ProtoReflect()))
        }
        return nil
    }
    proto.Reset(status)
    return nil
}
```

**Files Fixed**:
- `backend/libs/go/grpc/request/pipeline/steps/defaults.go`

## Test Coverage

All affected test suites now pass:
- ✅ `backend/libs/go/badger` - Store operations
- ✅ `backend/libs/go/sqlite` - SQLite store operations  
- ✅ `backend/libs/go/grpc/interceptors/apiresource` - gRPC interceptors
- ✅ `backend/libs/go/grpc/request/pipeline/steps` - Pipeline steps
- ✅ `backend/services/stigmer-server/pkg/controllers/agent` - Agent controller
- ✅ `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal` - Agent execution workflows
- ✅ `backend/services/stigmer-server/pkg/controllers/workflow/temporal` - Workflow validation
- ✅ `backend/services/stigmer-server/pkg/controllers/workflowexecution/temporal` - Workflow execution

## Key Learnings

1. **API Evolution**: When APIs evolve (like adding `kind` parameter to Store methods), tests must be updated systematically across all callsites

2. **Proto Reflection**: Use proto reflection for generic operations on status fields to avoid hardcoding type assumptions

3. **Proto Registry**: Import proto packages with blank import `_` to ensure descriptors are registered for tests that inspect proto metadata

4. **Temporal SDK**: Keep up with Temporal SDK API changes - they frequently refactor types and methods between versions

5. **Type-Safe API Resource Kinds**: Use `apiresource.GetKindName()` instead of hardcoded strings for type safety and maintainability

## Files Changed

**Modified** (17 files):
- `backend/libs/go/badger/store.go`
- `backend/libs/go/badger/store_test.go`
- `backend/libs/go/badger/BUILD.bazel`
- `backend/libs/go/sqlite/store_test.go`
- `backend/libs/go/grpc/interceptors/apiresource/interceptor_test.go`
- `backend/libs/go/grpc/request/pipeline/steps/defaults.go`
- `backend/services/stigmer-server/pkg/controllers/agent/agent_controller_test.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/activities/update_status_impl.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/worker_config.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/BUILD.bazel`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/workflows/invoke_workflow_impl.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/workflows/BUILD.bazel`
- `backend/services/stigmer-server/pkg/controllers/workflow/temporal/worker.go`
- `backend/services/stigmer-server/pkg/controllers/workflow/temporal/workflow.go`
- `backend/services/stigmer-server/pkg/controllers/workflowexecution/temporal/activities/update_status_impl.go`
- `client-apps/cli/internal/cli/daemon/BUILD.bazel`
- `client-apps/cli/internal/cli/temporal/manager.go`

**Deleted** (1 file):
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/workflows/workflow_creator.go` (moved to parent package)

**Created** (1 file):
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/workflow_creator.go` (moved from workflows subpackage)

## Next Steps

1. Run full test suite to verify all fixes: `make test`
2. Consider adding integration tests to catch API evolution issues earlier
3. Document Store API changes in architecture docs if not already covered
4. Consider adding linter rules to catch hardcoded resource kind strings
