# Add Temporal Callback Token to Execution Status

**Date**: 2026-01-22 08:48:28  
**Type**: Feature  
**Scope**: APIs (Proto)  
**Impact**: Foundation for async activity completion pattern

---

## Summary

Added `callback_token` field to `WorkflowExecutionStatus` and `AgentExecutionStatus` proto messages to enable Temporal's async activity completion pattern. This is Phase 1 of implementing the token handshake mechanism that allows long-running workflow and agent executions to complete external Temporal activities without blocking worker threads.

---

## What Changed

### Proto Definitions

#### WorkflowExecutionStatus

**File**: `apis/ai/stigmer/agentic/workflowexecution/v1/api.proto`

**Change**: Added field 11 to `WorkflowExecutionStatus`:

```protobuf
message WorkflowExecutionStatus {
  // ... existing fields (1-7) ...
  
  string temporal_workflow_id = 7;
  
  // Temporal callback token for async activity completion.
  // System-generated when triggered from Temporal activity.
  bytes callback_token = 11;
}
```

**Purpose**: Store the Temporal task token when a WorkflowExecution is triggered from an external Temporal activity, enabling async completion of that external activity when the workflow finishes.

#### AgentExecutionStatus

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`

**Change**: Added field 10 to `AgentExecutionStatus`:

```protobuf
message AgentExecutionStatus {
  // ... existing fields (1-9) ...
  
  map<string, TodoItem> todos = 9;
  
  // Temporal callback token for async activity completion.
  // Same pattern as WorkflowExecution.status.callback_token
  bytes callback_token = 10;
}
```

**Purpose**: Store the Temporal task token when an AgentExecution is triggered from a workflow task (e.g., `call: agent` task), enabling the workflow to wait for actual agent completion.

### Generated Code

**Go Stubs**:
- `apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1/api.pb.go`
- `apis/stubs/go/ai/stigmer/agentic/agentexecution/v1/api.pb.go`

**Python Stubs**:
- `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowexecution/v1/api_pb2.py`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/agentexecution/v1/api_pb2.pyi`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/agentexecution/v1/api_pb2.py`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/agentexecution/v1/api_pb2.pyi`

**Generated Accessors**:
```go
func (x *WorkflowExecutionStatus) GetCallbackToken() []byte
func (x *AgentExecutionStatus) GetCallbackToken() []byte
```

---

## Why This Change

### Problem Statement

When workflows or agents are invoked from Temporal activities, the calling activity currently receives an immediate ACK and continues without waiting for actual completion. This causes:
- Parent workflows to proceed before child work finishes
- Worker threads to block during long-running operations (if we add `run.Get()` to wait)
- Poor resource utilization and scalability issues

### Solution: Async Activity Completion Pattern

The Temporal async activity completion pattern solves this by:
1. Activity extracts task token (unique identifier for this activity execution)
2. Activity stores token in execution Status (system-managed state)
3. Activity returns `ErrResultPending` (pauses activity, frees worker thread)
4. Child execution runs (minutes/hours) while worker thread is free
5. Child execution completes external activity via token
6. Activity resumes with result, parent workflow continues

### Why Status (Not Spec)

The `callback_token` belongs in Status because:
- **System-generated**: Created by Temporal runtime, not provided by user
- **Runtime state**: Part of execution lifecycle, not user configuration
- **Ephemeral**: Only relevant during active execution, not for retries
- **Consistent**: Follows same pattern as `temporal_workflow_id` (also in Status)

This adheres to Stigmer's Spec/Status separation pattern:
- **Spec**: User inputs (immutable after creation)
- **Status**: System state (continuously updated)

---

## Design Decisions

### Decision 1: Status Placement (Not Input/Spec)

**Initial approach**: Added token to `WorkflowExecuteInput` (gRPC interface)

**Problem discovered**: 
- gRPC interface is not used by Temporal workflows (they use Go structs)
- Token is system-generated, not user input
- Violates Spec/Status separation

**Correction**: Moved token to Status messages

**Rationale**: System-managed state belongs in Status, following existing pattern (`temporal_workflow_id` is also in Status).

### Decision 2: Field Numbers

**WorkflowExecutionStatus**: Field 11
- Fields 1-7 already used
- Field 8-10 reserved for future status fields
- Field 11 chosen for Temporal-specific state

**AgentExecutionStatus**: Field 10
- Fields 1-9 already used
- Field 10 available
- Keeps Temporal-related fields grouped

### Decision 3: Field Type (bytes)

**Type**: `bytes` (not `string`)

**Rationale**:
- Token is opaque binary data from Temporal (100-200 bytes)
- Should not be interpreted or modified
- Binary format is most efficient
- Matches Temporal SDK expectations

### Decision 4: Optional Field

**Requirement**: Not required (optional)

**Rationale**:
- Backward compatibility: Existing executions without token continue working
- Direct calls don't need token (only Temporal activity invocations)
- Graceful degradation: Empty token = normal execution

---

## Architecture Understanding

### Discovery: Two Execution Paths

**Path 1: Temporal Workflow** (production):
```
ExecuteWorkflowActivity (Go Temporal activity)
  → temporalClient.ExecuteWorkflow()
  → ExecuteServerlessWorkflow (Go Temporal workflow)
  → Uses: TemporalWorkflowInput struct (NOT gRPC proto)
```

**Path 2: Direct gRPC** (testing/external calls):
```
External Client
  → WorkflowRunnerServiceController.ExecuteAsync (gRPC)
  → Uses: WorkflowExecuteInput proto
```

**Key insight**: Temporal workflows don't use the gRPC interface! They use Go structs passed via Temporal's serialization.

### Discovery: Nested Workflows

The architecture has two levels:
1. **Outer**: `InvokeWorkflowExecutionWorkflow` (stigmer-server)
2. **Inner**: `ExecuteServerlessWorkflow` (workflow-runner)

Token handshake happens between the activity bridge and inner workflow.

---

## Implementation Status

### Phase 1: Proto Definition ✅ COMPLETED

- [x] Added `callback_token` to WorkflowExecutionStatus (field 11)
- [x] Added `callback_token` to AgentExecutionStatus (field 10)
- [x] Comprehensive documentation (60+ lines per field)
- [x] Proto code regenerated (Go and Python)
- [x] Build verification passed
- [x] Backward compatible (optional field)

### Next Phases (Not Yet Started)

**Phase 2**: Update `TemporalWorkflowInput` Go struct  
**Phase 3**: Implement token extraction in `ExecuteWorkflowActivity`  
**Phase 4**: Store token in Status via `updateStatus` RPC  
**Phase 5**: Pass token to `ExecuteServerlessWorkflow`  
**Phase 6**: Return `activity.ErrResultPending` when token exists  
**Phase 7**: Implement System Activities for completion  
**Phase 8**: Update `ExecuteServerlessWorkflow` to complete external activity  
**Phase 9**: Testing and observability  

---

## Files Modified

### Proto Definitions (Source)
- `apis/ai/stigmer/agentic/workflowexecution/v1/api.proto` - Added callback_token (field 11)
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` - Added callback_token (field 10)
- `apis/ai/stigmer/agentic/workflowrunner/v1/io.proto` - Reverted incorrect change

### Generated Go Stubs
- `apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1/api.pb.go` - Generated
- `apis/stubs/go/ai/stigmer/agentic/agentexecution/v1/api.pb.go` - Generated

### Generated Python Stubs
- `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowexecution/v1/api_pb2.py` - Generated
- `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowexecution/v1/api_pb2.pyi` - Generated
- `apis/stubs/python/stigmer/ai/stigmer/agentic/agentexecution/v1/api_pb2.py` - Generated
- `apis/stubs/python/stigmer/ai/stigmer/agentic/agentexecution/v1/api_pb2.pyi` - Generated

### Project Documentation
- `_projects/2026-01/20260122.03.temporal-token-handshake/tasks/T01_1_review.md` - Plan approval
- `_projects/2026-01/20260122.03.temporal-token-handshake/tasks/T01_2_execution.md` - Execution tracking
- `_projects/2026-01/20260122.03.temporal-token-handshake/checkpoints/CP01_phase1_complete.md` - Phase 1 checkpoint
- `_projects/2026-01/20260122.03.temporal-token-handshake/checkpoints/CP02_architecture_corrected.md` - Architecture correction
- `_projects/2026-01/20260122.03.temporal-token-handshake/design-decisions/01-architecture-discovery.md` - Architecture analysis
- `_projects/2026-01/20260122.03.temporal-token-handshake/design-decisions/02-architecture-correction.md` - Correction plan
- `_projects/2026-01/20260122.03.temporal-token-handshake/next-task.md` - Updated status

**Total**: 15 files modified/created

---

## Technical Details

### Token Lifecycle

1. **Creation**: Activity calls `activity.GetInfo(ctx).TaskToken`
2. **Storage**: Token stored in `execution.status.callback_token` via `updateStatus` RPC
3. **Persistence**: Saved to MongoDB as part of WorkflowExecution/AgentExecution resource
4. **Passing**: Token passed in `TemporalWorkflowInput.CallbackToken` Go struct
5. **Completion**: `ActivityCompletionClient.complete(token, result)` wakes up activity
6. **Cleanup**: Token cleared when execution reaches terminal state

### Backward Compatibility

**Without token** (existing behavior):
- Workflows execute normally
- No external activity completion attempted
- Results returned via status updates

**With token** (new behavior):
- Activity pauses (worker thread freed)
- Workflow executes in background
- External activity completed via token
- Activity resumes with result

No breaking changes - existing code continues working.

### Field Documentation

Each field includes comprehensive inline documentation covering:
- Token handshake pattern explanation
- Architecture benefits (no blocking, resilience, decoupling)
- Why Status (not Spec) with clear rationale
- Backward compatibility behavior
- Token format and handling guidelines
- Use cases (orchestrated vs direct)
- Security considerations
- References to ADR and Temporal docs

Documentation quality: 60+ lines per field ensuring developers understand the pattern without external documentation.

---

## Why This Matters

### Scalability

**Before**: 10 workers, 10 long-running workflows = all workers blocked  
**After**: 10 workers can handle 100+ long-running workflows (threads freed while waiting)

### Correctness

**Before**: Parent workflow continues before child finishes (race conditions)  
**After**: Parent correctly waits for child completion (proper sequencing)

### Resource Efficiency

**Before**: Worker threads blocked for minutes/hours  
**After**: Worker threads freed immediately, can process other work

---

## Learnings

### 1. Spec/Status Separation Pattern

**Key insight**: System-generated state belongs in Status, not Spec/Input

Applied to:
- `temporal_workflow_id` (field 7) - Already in Status
- `callback_token` (field 11) - Added to Status (corrected from initial wrong placement)

This pattern is fundamental to Stigmer's API design and must be followed consistently.

### 2. Temporal Workflows Use Go Structs, Not gRPC Protos

**Discovery**: `ExecuteWorkflowActivity` calls `ExecuteServerlessWorkflow` via `temporalClient.ExecuteWorkflow()`, passing `TemporalWorkflowInput` struct.

**Impact**: The gRPC `WorkflowExecuteInput` proto is only for direct external calls, not for Temporal workflow invocations.

**Learning**: When adding fields for Temporal workflows, update the Go struct (`TemporalWorkflowInput`), not just the gRPC proto.

### 3. Architecture Has Two Levels

**Outer Level**: `InvokeWorkflowExecutionWorkflow` (stigmer-server)
- Orchestrates workflow execution
- Calls activity on runner queue

**Inner Level**: `ExecuteServerlessWorkflow` (workflow-runner)
- Executes actual workflow tasks
- Can invoke agents (nested activities)

**Token handshake location**: Between the activity bridge (`ExecuteWorkflowActivity`) and inner workflow (`ExecuteServerlessWorkflow`).

---

## Related ADR

**ADR**: `docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`

This changelog implements Phase 1 (Proto Definition) from the ADR's implementation checklist:
- ✅ Add `callback_token` field to proto definitions
- ✅ Regenerate code
- ✅ Update documentation

**Next phases** (implementation in progress):
- Phase 2: Zigflow (Go) Activity - Extract and store token
- Phase 3: Pass token to inner workflow
- Phase 4: Return `ErrResultPending`
- Phase 5: Complete external activity on finish

---

## Testing

### Proto Compilation
- ✅ Go stubs compile without errors
- ✅ Python stubs compile without errors
- ✅ No breaking changes to existing code

### Build Verification
- ✅ `make protos` completed successfully
- ✅ `bazel build //apis/stubs/go/...` passed
- ✅ All generated code passes validation

### Backward Compatibility
- ✅ Field is optional (empty by default)
- ✅ Existing code without token continues working
- ✅ No migration needed for existing executions

---

## Impact Assessment

### User Impact
**None** - This is internal infrastructure preparation for future async features.

### Developer Impact
**Low** - Proto changes are backward compatible. Developers don't need to change existing code.

### System Impact
**Foundation** - Enables future async activity completion implementation, which will:
- Improve scalability (worker thread efficiency)
- Improve correctness (proper execution sequencing)
- Reduce resource consumption (no blocking waits)

---

## Documentation

### Inline Proto Documentation

Comprehensive field documentation added directly in proto files:
- Token handshake pattern explanation (step-by-step flow)
- Architecture benefits and rationale
- Why Status vs Spec (design decision with reasoning)
- Backward compatibility behavior
- Token format and handling guidelines
- Use cases (orchestrated vs direct execution)
- Security considerations (sensitive data handling)
- Observability recommendations
- References to ADR and Temporal documentation

**Quality**: 60+ lines per field ensuring understanding without external docs.

### Project Documentation

Created in `_projects/2026-01/20260122.03.temporal-token-handshake/`:
- `tasks/T01_1_review.md` - Plan approval documentation
- `tasks/T01_2_execution.md` - Phase execution tracking
- `checkpoints/CP01_phase1_complete.md` - Phase 1 completion
- `checkpoints/CP02_architecture_corrected.md` - Architecture correction details
- `design-decisions/01-architecture-discovery.md` - Polyglot workflow analysis
- `design-decisions/02-architecture-correction.md` - Token placement correction
- `next-task.md` - Updated with Phase 2 status

---

## What's Next

### Phase 2: Go Implementation (Next)

**Tasks**:
1. Add `CallbackToken []byte` to `TemporalWorkflowInput` struct
2. Update `ExecuteWorkflowActivity` to:
   - Extract token: `activity.GetInfo(ctx).TaskToken`
   - Store in Status: `updateStatus(status.CallbackToken = token)`
   - Pass to workflow: `workflowInput.CallbackToken = token`
   - Return pending: `return nil, activity.ErrResultPending` (if token exists)
3. Add comprehensive logging (Base64 encoded token, truncated)

**Files to modify**:
- `backend/services/workflow-runner/pkg/types/progress.go` - Add CallbackToken field
- `backend/services/workflow-runner/worker/activities/execute_workflow_activity.go` - Implement token handling

### Phase 3: Workflow Completion (After Phase 2)

**Tasks**:
1. Update `ExecuteServerlessWorkflow` to accept token in input
2. On success: Complete external activity with result
3. On failure: Fail external activity with error
4. Create System Activities for deterministic completion

---

## Validation

### Proto Lint
✅ Passed - No linting errors

### Proto Format
✅ Passed - All files formatted

### Build
✅ Passed - Go and Python stubs compile

### Backward Compatibility
✅ Verified - Optional fields, no breaking changes

---

## References

- **ADR**: `docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`
- **Project**: `_projects/2026-01/20260122.03.temporal-token-handshake/`
- **Temporal Docs**: https://docs.temporal.io/activities#asynchronous-activity-completion
- **Go SDK**: https://pkg.go.dev/go.temporal.io/sdk/activity#ErrResultPending
- **Java SDK**: https://www.javadoc.io/doc/io.temporal/temporal-sdk/latest/io/temporal/client/ActivityCompletionClient.html

---

**Status**: Phase 1 Complete - Proto definitions ready for Go implementation  
**Next**: Phase 2 - Implement token extraction and handling in Go activities
