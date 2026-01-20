# Fix: Nil Pointer Panic in WorkflowInstance Controller Tests

**Date:** 2026-01-20  
**Type:** Bug Fix  
**Scope:** Test Infrastructure  
**Impact:** CI/Testing

## Problem

The `TestWorkflowInstanceController_Create/successful_creation_with_workflow_id` test was panicking with a nil pointer dereference when creating workflows:

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x2 addr=0x0 pc=0x100c7e354]

github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance.(*Client).CreateAsSystem(0x0, ...)
```

**Root Cause:** Circular dependency in test setup between Workflow and WorkflowInstance gRPC services:
- Workflow controller needs WorkflowInstance client (to create default instances when workflows are created)
- WorkflowInstance controller needs Workflow client (to validate parent workflows when instances are created)

The test setup was creating the WorkflowInstance gRPC server with a `nil` Workflow client, which caused the panic when workflows tried to create default instances via gRPC.

## Solution

Created a unified server setup function that properly handles the circular dependency:

### File: `workflowinstance_controller_test.go`

**Added `setupInProcessServers()` function**:
1. Creates both gRPC listeners first (workflow + workflowinstance)
2. Creates client connections before controllers (enables early client creation)
3. Creates clients from connections (both available before controller creation)
4. Creates controllers with proper cross-dependencies (workflow controller gets workflowinstance client, workflowinstance controller gets workflow client)
5. Registers controllers with gRPC servers
6. Starts both servers

**Replaced separate server setup functions**:
- Old: `setupInProcessWorkflowServer()` created workflow server with nil workflowinstance client
- Old: `setupInProcessWorkflowInstanceServer()` created workflowinstance server with nil workflow client
- New: `setupInProcessServers()` creates both servers with properly wired clients

### Key Implementation Details

**Bootstrap sequence**:
```go
// STEP 1: Create listeners for both servers
workflowListener := bufconn.Listen(1024 * 1024)
workflowInstanceListener := bufconn.Listen(1024 * 1024)

// STEP 2: Create client connections BEFORE starting servers
workflowConn, _ := grpc.DialContext(..., workflowListener)
workflowInstanceConn, _ := grpc.DialContext(..., workflowInstanceListener)

// STEP 3: Create clients from connections
workflowClient := workflow.NewClient(workflowConn)
workflowInstanceClient := workflowinstance.NewClient(workflowInstanceConn)

// STEP 4: Create controllers with proper cross-dependencies
workflowController := workflowcontroller.NewWorkflowController(store, workflowInstanceClient)
workflowInstanceController := NewWorkflowInstanceController(store, workflowClient)

// STEP 5: Register and start servers
// (both servers now have controllers with properly initialized clients)
```

**Why this works**:
- bufconn listeners can accept connections before servers start serving
- Client connections can be created before servers start accepting requests
- Controllers get both clients before any RPC calls are made
- When workflow creation triggers default instance creation, both clients are ready

## Impact

**Tests Fixed:**
- ✅ `TestWorkflowInstanceController_Create/successful_creation_with_workflow_id` - was panicking, now passes

**Test Infrastructure Improved:**
- Proper handling of circular gRPC dependencies in tests
- Both workflow and workflowinstance services can call each other via in-process gRPC
- Full interceptor chain executes (validation, api_resource_kind injection, etc.)

## Remaining Test Failures

After fixing the panic, discovered 5 additional test failures related to proto unmarshaling:

```
proto: syntax error (line 2:1): invalid value \u0015
Failed to unmarshal workflow instance, skipping
```

**Failing tests** (separate issue, not addressed in this fix):
1. `TestWorkflowController_GetByReference/successful_get_by_slug`
2. `TestWorkflowController_Update/update_non-existent_workflow`
3. `TestWorkflowInstanceController_GetByReference/successful_get_by_slug`
4. `TestWorkflowInstanceController_Update/successful_update`
5. `TestWorkflowInstanceController_GetByWorkflow/successful_get_by_workflow_with_multiple_instances`

All failures have the same root cause: resources are being created but fail to unmarshal when retrieved from storage. This is a separate persistence/serialization issue that needs investigation.

## Files Changed

```
M backend/services/stigmer-server/pkg/domain/workflowinstance/controller/workflowinstance_controller_test.go
```

**Changes:**
- Added `setupInProcessServers()` - unified server setup handling circular dependencies
- Updated `setupTestController()` - uses new unified setup
- Added import: `github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance`
- Removed separate `setupInProcessWorkflowServer()` and `setupInProcessWorkflowInstanceServer()` functions

## Testing

**Before fix:**
```bash
$ make test-root
# TestWorkflowInstanceController_Create/successful_creation_with_workflow_id - PANIC
# Exit code: 2
```

**After fix:**
```bash
$ go test -v ./backend/services/stigmer-server/pkg/domain/workflowinstance/controller -run TestWorkflowInstanceController_Create/successful_creation_with_workflow_id
# PASS (no panic)
```

## Technical Notes

**Pattern: Circular gRPC Dependencies in Tests**

When setting up in-process gRPC servers with circular dependencies:

1. **Don't** create servers sequentially with nil clients
2. **Don't** try to update controller clients after registration
3. **Do** create all connections first using bufconn
4. **Do** create all clients before creating controllers
5. **Do** wire controllers with proper dependencies before server registration

**Why bufconn enables this pattern:**
- bufconn listeners accept connections before servers start
- Client connections can dial before servers serve
- This breaks the chicken-and-egg problem

This pattern is reusable for any test scenario with mutually dependent gRPC services.

## Related Work

**Context:** This fix is part of implementing the new workflow default instance feature, where:
- Creating a workflow automatically creates a default workflow instance
- Workflow creation pipeline includes a `CreateDefaultInstance` step
- This step calls WorkflowInstanceController via in-process gRPC

The test infrastructure needed updating to support this new cross-service dependency.

## Next Steps

Investigate and fix the proto unmarshaling failures (separate issue):
- All 5 remaining failures show `proto: syntax error (line 2:1): invalid value \u0015`
- Resources save successfully but fail to unmarshal on retrieval
- Likely a serialization format mismatch in BadgerDB storage layer
