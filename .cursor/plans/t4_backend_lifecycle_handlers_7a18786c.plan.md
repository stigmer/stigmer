---
name: T4 Backend Lifecycle Handlers
overview: Implement cancel, terminate, and recover handlers in stigmer-cloud for WorkflowExecution lifecycle control, following established pipeline patterns and integrating with Temporal APIs.
todos:
  - id: cancel-handler
    content: Implement WorkflowExecutionCancelHandler with full pipeline (validates pattern)
    status: completed
  - id: terminate-handler
    content: Implement WorkflowExecutionTerminateHandler (similar to cancel, different Temporal call)
    status: completed
  - id: recover-handler
    content: Implement WorkflowExecutionRecoverHandler with Temporal reset integration
    status: completed
  - id: unit-tests
    content: Create unit tests for all three handlers with mocked WorkflowClient
    status: completed
  - id: build-verify
    content: Verify bazel build passes and handlers are properly registered
    status: pending
isProject: false
---

# T4: Backend Handlers for Workflow Execution Lifecycle Control

## Summary

Implement three gRPC handlers in `stigmer-cloud` to enable user-facing lifecycle control:

- `cancel` - graceful stop via Temporal CancelWorkflow
- `terminate` - force stop via Temporal TerminateWorkflow  
- `recover` - resume from failure via Temporal ResetWorkflow

## Architecture Decision: Temporal API Complexity

**Observation**: Cancel and terminate use high-level `WorkflowStub` API, but **reset requires lower-level `WorkflowServiceStubs` gRPC API**.

```java
// Cancel/Terminate: Simple WorkflowStub API
WorkflowStub stub = workflowClient.newUntypedWorkflowStub(workflowId);
stub.cancel();  // or stub.terminate(reason);

// Reset: Requires WorkflowServiceStubs (lower-level gRPC)
workflowServiceStubs.blockingStub().resetWorkflowExecution(
    ResetWorkflowExecutionRequest.newBuilder()
        .setWorkflowExecution(...)
        .setWorkflowTaskFinishEventId(...)
        .build()
);
```

**Recommendation**: Start with cancel and terminate (simpler, validates pattern), then tackle recover. This allows early validation of the pipeline approach before the complex reset integration.

## Key Implementation Details

### Workflow ID Derivation

From `[InvokeWorkflowExecutionWorkflowCreator.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/workflow/InvokeWorkflowExecutionWorkflowCreator.java)`:

```java
// Format: stigmer/workflow-execution/invoke/{execution-id}
var workflowId = "%s/%s".formatted(
    WorkflowExecutionTemporalWorkflowTypes.WORKFLOW_EXECUTION_INVOKE, 
    executionId);
```

All handlers must use this same derivation to target the correct Temporal workflow.

### Handler Pattern (from existing handlers)

Each handler follows this structure:

```java
@RequestRoute(controller = WorkflowExecutionCommandControllerGrpc.class,
        method = WorkflowExecutionCommandController.Method.cancel)
public class WorkflowExecutionCancelHandler 
    extends CustomOperationHandlerV2<CancelWorkflowExecutionInput, WorkflowExecution> {
    
    @Override
    protected RequestPipelineV2<...> pipeline() {
        return RequestPipelineV2.<...>builder(...)
            .addStep(loadExistingStep)      // 1. Load from DB
            .addStep(authorizeStep)          // 2. Check can_edit
            .addStep(validatePhaseStep)      // 3. Check cancellable
            .addStep(cancelTemporalStep)     // 4. Call Temporal
            .addStep(updateStatusStep)       // 5. Update DB
            .addStep(publishToRedisStep)     // 6. Real-time update
            .build();
    }
}
```

### Phase Validation Rules


| Operation   | Valid Source Phases  | Target Phase | Can Be Idempotent?        |
| ----------- | -------------------- | ------------ | ------------------------- |
| `cancel`    | PENDING, IN_PROGRESS | CANCELLED    | Yes (already CANCELLED)   |
| `terminate` | PENDING, IN_PROGRESS | TERMINATED   | Yes (already TERMINATED)  |
| `recover`   | FAILED only          | IN_PROGRESS  | Yes (already IN_PROGRESS) |


### Error Handling for Temporal Operations

From existing signal handler patterns:

```java
try {
    stub.cancel();
} catch (WorkflowNotFoundException e) {
    // Workflow already completed/terminated - may be idempotent success
    return handleWorkflowNotFound(context, e);
} catch (WorkflowServiceException e) {
    // Transient error - UNAVAILABLE
    return failure(Status.UNAVAILABLE, "Temporal service unavailable");
} catch (Exception e) {
    return failure(Status.INTERNAL, "Unexpected error: " + e.getMessage());
}
```

## Files to Create

### Handler Files


| File                                                                       | Purpose                         |
| -------------------------------------------------------------------------- | ------------------------------- |
| `workflowexecution/request/handler/WorkflowExecutionCancelHandler.java`    | Cancel handler with pipeline    |
| `workflowexecution/request/handler/WorkflowExecutionTerminateHandler.java` | Terminate handler with pipeline |
| `workflowexecution/request/handler/WorkflowExecutionRecoverHandler.java`   | Recover handler with pipeline   |


### Potential Shared Utility


| File                                                                  | Purpose                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| `workflowexecution/temporal/WorkflowExecutionTemporalOperations.java` | *Optional* - encapsulate Temporal lifecycle operations |


**Note**: The utility is optional. We should decide if sharing Temporal interaction code is worth the abstraction, or if keeping logic in steps is cleaner.

## Implementation Approach

### Phase 1: Cancel Handler (validates pattern)

1. Create `WorkflowExecutionCancelHandler.java`
2. Implement pipeline steps:
  - `LoadExistingStep` - reuse pattern from UpdateStatus
  - `AuthorizeStep` - reuse pattern from SubmitApproval
  - `ValidateCancellableStep` - check PENDING/IN_PROGRESS
  - `CancelTemporalWorkflowStep` - call `stub.cancel()`
  - `UpdatePhaseStep` - set CANCELLED, completed_at
  - `PersistStep` - save to MongoDB
  - `PublishToRedisStep` - real-time notification

### Phase 2: Terminate Handler (similar to cancel)

1. Create `WorkflowExecutionTerminateHandler.java`
2. Nearly identical to cancel, but:
  - Uses `stub.terminate(reason)` instead of `stub.cancel()`
  - Sets phase to TERMINATED
  - May set `status.error` with termination reason

### Phase 3: Recover Handler (more complex)

1. Create `WorkflowExecutionRecoverHandler.java`
2. Key differences:
  - Validates phase is FAILED (not PENDING/IN_PROGRESS)
  - Requires finding the reset point (last successful WorkflowTaskCompleted)
  - Uses `WorkflowServiceStubs.resetWorkflowExecution()` 
  - Creates new Temporal run in same workflow ID chain
  - Sets phase back to IN_PROGRESS

## Open Questions for Discussion

### 1. Reset Event ID Strategy

Temporal reset requires specifying which event to reset to. Options:

- **Option A: LastWorkflowTask** - Reset to the last successful workflow task (safest default)
- **Option B: User-provided** - Let user specify reset point (more control, more complexity)

**Recommendation**: Start with Option A (LastWorkflowTask) for MVP. This matches `temporal workflow reset --type LastWorkflowTask` behavior.

### 2. Shared Temporal Operations Class

Should we create `WorkflowExecutionTemporalOperations.java` to encapsulate:

- Workflow ID derivation
- Cancel/terminate/reset operations
- Error mapping

Or keep the Temporal calls directly in pipeline steps (like existing signal handler)?

**Recommendation**: Keep in steps for now (follows existing pattern), extract if duplication becomes problematic.

### 3. Database Update vs Temporal Status

Currently, the workflow-runner updates status via `updateStatus` RPC. When we cancel/terminate:

- Should we update DB immediately after Temporal call?
- Or wait for workflow-runner to send final status update?

**Recommendation**: Update DB immediately (optimistic) since:

1. User expects immediate feedback
2. Temporal operations are authoritative
3. If workflow-runner sends conflicting update later, latest wins

### 4. Audit Logging

Should cancel/terminate/recover include structured audit logging similar to `submitApproval`?

```java
log.info("AUDIT: Workflow {} by {} - execution_id={}, reason='{}'",
    operation, callerIdentity, executionId, reason);
```

**Recommendation**: Yes, these are significant operations that should be auditable.

## Test Strategy

- Unit tests for each handler with mocked Temporal client
- Follow patterns from `NotifyParentActivitiesImplTest.java` for WorkflowClient mocking
- Test idempotency scenarios (cancel already-cancelled, etc.)
- Test error scenarios (workflow not found, service unavailable)

## Build Verification

After implementation:

- `bazel build //backend/services/stigmer-service/...`
- Regenerate stubs if needed: `make build` in `apis/` directory
- Verify new handlers are registered via `@RequestRoute` annotation

