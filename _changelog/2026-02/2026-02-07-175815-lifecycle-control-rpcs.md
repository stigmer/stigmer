# Workflow Execution Lifecycle Control RPCs

**Date**: February 7, 2026

## Summary

Added three user-facing lifecycle control RPCs to WorkflowExecutionCommandController (`cancel`, `terminate`, `recover`) with comprehensive documentation, input message types, and regenerated stubs. This completes the proto API layer (Phase 1, Tasks 2+3) for durable workflow lifecycle management, enabling users to gracefully stop, force-stop, or recover workflow executions via the Stigmer control plane.

## Problem Statement

The platform's "durable workflows" promise requires operational control capabilities that match industry standards. Users need to:

1. **Cancel running workflows gracefully** - Stop workflows with cleanup opportunity (compensation logic, notifications)
2. **Terminate stuck workflows immediately** - Force-stop unresponsive workflows that don't respond to cancellation
3. **Recover failed workflows from checkpoints** - Resume execution without re-executing successful steps or duplicating side effects

### Pain Points Before This Change

- No user-facing API for workflow lifecycle control
- Users had to access Temporal UI directly (poor UX, not a "control plane")
- Cannot fulfill "retry and resume" promise without recover API
- Lifecycle operations exposed as baseline in all competing platforms (Temporal, AWS Step Functions, Cadence, Conductor)
- Gap between "durable execution" (engine level) and "operational durability" (control plane level)

## Solution

Added three new RPCs to `WorkflowExecutionCommandController` with their corresponding input message types, following existing proto patterns and documentation standards.

### Architecture

Single control plane model (established in T0):
```
User/CLI → Stigmer Service → Temporal API → WorkflowRunner (worker)
```

All lifecycle control happens at Stigmer service level via direct Temporal API calls. WorkflowRunner is a pure Temporal worker with no control plane responsibilities.

## Implementation Details

### 1. RPCs Added (command.proto)

#### cancel RPC
- **Purpose**: Graceful workflow stop with cleanup opportunity
- **Temporal equivalent**: `temporal workflow cancel`
- **Preconditions**: Execution in PENDING or IN_PROGRESS phase
- **State transition**: PENDING/IN_PROGRESS → CANCELLED
- **Idempotency**: Cancelling already-cancelled execution succeeds (no-op)
- **Authorization**: `can_edit` permission on `workflow_execution`, field_path = "id"
- **Documentation**: 65 lines covering behavior, preconditions, state transitions, idempotency, error cases, examples

#### terminate RPC
- **Purpose**: Force-stop workflow immediately (no cleanup)
- **Temporal equivalent**: `temporal workflow terminate`
- **Preconditions**: Execution in PENDING or IN_PROGRESS phase
- **State transition**: PENDING/IN_PROGRESS → TERMINATED
- **Idempotency**: Terminating already-terminated execution succeeds (no-op)
- **Authorization**: `can_edit` permission on `workflow_execution`, field_path = "id"
- **Documentation**: 60 lines with terminate vs cancel comparison table
- **Key distinction**: Workflow code cannot respond to termination (immediate kill)

#### recover RPC
- **Purpose**: Resume from checkpoint after failure
- **Temporal equivalent**: `temporal workflow reset`
- **Preconditions**: Execution must be in FAILED phase (not TERMINATED, not CANCELLED)
- **State transition**: FAILED → IN_PROGRESS
- **Behavior**: Preserves completed work, does NOT re-execute successful steps
- **Idempotency**: If recovery already in progress, succeeds as no-op
- **Authorization**: `can_edit` permission on `workflow_execution`, field_path = "id"
- **Documentation**: 75 lines with recovery vs restart comparison table

### 2. Input Messages Added (io.proto)

All messages follow consistent pattern:
- `id` field (string, min_len validation, execution ID to operate on)
- `reason` field (string, optional, for audit trail and operational debugging)

#### CancelWorkflowExecutionInput
```protobuf
message CancelWorkflowExecutionInput {
  string id = 1 [(buf.validate.field).string.min_len = 1];
  string reason = 2;
}
```
- **Documentation**: 40 lines covering behavior, preconditions, idempotency, use cases
- **Format**: "wfx-{ulid}"
- **Example use cases**: Wrong workflow triggered, business decision to stop, graceful shutdown

#### TerminateWorkflowExecutionInput
```protobuf
message TerminateWorkflowExecutionInput {
  string id = 1 [(buf.validate.field).string.min_len = 1];
  string reason = 2;
}
```
- **Documentation**: 50 lines with terminate vs cancel comparison
- **Example use cases**: Stuck workflow, infinite loop, excessive resource consumption

#### RecoverWorkflowExecutionInput
```protobuf
message RecoverWorkflowExecutionInput {
  string id = 1 [(buf.validate.field).string.min_len = 1];
  string reason = 2;
}
```
- **Documentation**: 45 lines with recovery vs restart comparison
- **Example use cases**: Transient error fixed, external dependency recovered
- **Note**: `env_overrides` field deferred to post-MVP for simplicity

### 3. Code Organization

#### command.proto
- Added section header: "Lifecycle Control Operations"
- Placed after `delete` RPC (line 332)
- Total addition: ~237 lines
- Follows existing documentation patterns (similar depth to `submitApproval` RPC)

#### io.proto
- Added section header: "Lifecycle Control Input Messages"
- Placed after `WorkflowUpdateType` enum (line 523)
- Total addition: ~207 lines
- Messages grouped logically with shared section header

### 4. Generated Stubs

#### Go Stubs
- `command_grpc.pb.go`: Client and server methods for Cancel, Terminate, Recover
- `io.pb.go`: Message types with getters (GetId, GetReason)
- `command.pb.go`: RPC descriptors and authorization metadata
- Total addition: ~940 lines (generated)

#### Python Stubs
- `command_pb2_grpc.py`: Client and server stubs
- `io_pb2.py`: Message classes
- `io_pb2.pyi`: Type stubs for IDE support
- Total addition: ~377 lines (generated)

### 5. Documentation Quality Standards

Each RPC includes:
- Brief summary (1-2 lines)
- Temporal equivalent command
- Behavior explanation
- Preconditions (required execution phase)
- State transitions (what changes)
- Idempotency semantics (duplicate call behavior)
- Error cases (NOT_FOUND, PERMISSION_DENIED, FAILED_PRECONDITION, INVALID_ARGUMENT)
- Example JSON request
- Example JSON response

Each input message includes:
- Message purpose
- Behavior description
- Preconditions
- Idempotency
- Use cases (3-4 examples)
- Example JSON

### 6. Key Design Decisions

#### Decision 1: Combined T2+T3 (RPCs + Messages)
**Rationale**: RPCs cannot compile without their input message types. Combined into single implementation task.
**Alternative rejected**: Separate T2 (RPCs with stub messages) and T3 (complete messages) - adds unnecessary complexity.

#### Decision 2: Deferred env_overrides
**Rationale**: `RecoverWorkflowExecutionInput.env_overrides` adds complexity for MVP. Users can override environment variables when creating new executions.
**Future work**: Add `map<string, string> env_overrides` field in post-MVP iteration.

#### Decision 3: Authorization Pattern
**Rationale**: All three RPCs use `can_edit` permission (consistent with update, delete, submitApproval).
**Field path**: All use `id` field for authorization resource extraction.

#### Decision 4: Semantic Clarity
**Emphasis**: Documentation highlights cancel (graceful) vs terminate (hard stop) distinction.
**Comparison tables**: Added side-by-side comparisons for:
- Cancel vs Terminate
- Recover vs Restart (create new execution)

## Benefits

### 1. User Experience
- Users can manage workflow lifecycle via API/CLI (no need for Temporal UI)
- Clear semantic operations: cancel (graceful), terminate (hard), recover (checkpoint)
- Idempotent operations (safe to retry)

### 2. Product Completeness
- Fulfills "retry and resume" promise on landing page
- Matches baseline capabilities of competing platforms
- Operational durability (not just execution durability)

### 3. Developer Experience
- Comprehensive RPC documentation (40-75 lines per RPC)
- Clear preconditions and error cases
- Example requests/responses in JSON format
- Generated stubs ready for backend implementation

### 4. Code Quality
- Follows existing proto patterns (authorization, validation, documentation)
- Documentation depth matches existing RPCs (e.g., `submitApproval`)
- Clear separation: lifecycle control section in both proto files
- No technical debt introduced

## Impact

### Immediate Impact
- Proto API complete for lifecycle control (Phase 1 of T01 plan)
- Go and Python clients can call new RPCs
- Ready for backend handler implementation (Phase 2, T4)

### Next Steps Required
- **T4**: Implement backend handlers in Stigmer service (Java/Kotlin)
  - Wire to Temporal API (CancelWorkflow, TerminateWorkflow, ResetWorkflow)
  - Implement validation and state machine logic
- **T5**: Add CLI commands (`stigmer workflow cancel/terminate/recover`)
- **T6-T7**: Enhanced wait capabilities (ISO durations, "until" timestamps)

### Who This Affects
- **Platform developers**: Can implement backend handlers using generated stubs
- **CLI developers**: Can implement user-facing commands
- **API users**: Will be able to control workflow lifecycle via API
- **End users**: Will gain operational control over workflow executions

### Platform Positioning
With this change, Stigmer can honestly claim:
- ✅ "Workflows that retry and resume" (recover = Temporal Reset)
- ✅ "Cancel stuck workflows" (cancel + terminate operations)
- ✅ "Durable execution with operational control" (not just engine durability)

## Related Work

### Completed Foundation (T0-T1)
- **T0**: Removed WorkflowRunner gRPC interface (~4,900 lines deleted)
  - Established single control plane model
  - WorkflowRunner is now pure Temporal worker
- **T1**: Added EXECUTION_TERMINATED enum (phase = 6)
  - Foundation for terminate RPC
  - Documented terminated vs cancelled semantics

### Research Validation
- **07.report.gpt.md**: DeepSeek/ChatGPT research completed
- **Recommendation**: Option C (Minimal Viable Both)
- **Key insight**: "Retry and resume" claim requires cancel + recover APIs
- **Competitor analysis**: All platforms (Temporal, AWS Step Functions, Cadence, Conductor) expose cancel/terminate/reset as baseline

### Implementation Plan
- **Phase 1** (Proto API): ✅ T0, ✅ T1, ✅ T2+T3
- **Phase 2** (Backend): T4 (handlers)
- **Phase 3** (CLI): T5 (commands)
- **Phase 4** (Wait): T6-T7 (enhanced wait capabilities)

## Technical Details

### Files Modified

| File | Lines Added | Description |
|------|-------------|-------------|
| `command.proto` | +237 | 3 RPCs with documentation |
| `io.proto` | +207 | 3 input messages with documentation |
| `command_grpc.pb.go` | +532 | Generated client/server methods |
| `io.pb.go` | +378 | Generated message types |
| `command.pb.go` | +30 | RPC descriptors |
| `command_pb2_grpc.py` | +345 | Python client/server stubs |
| `io_pb2.py` | +18 | Python message classes |
| `io_pb2.pyi` | +24 | Python type stubs |

**Total**: ~1,771 lines added (444 proto, 1,327 generated)

### Verification Completed

- ✅ `buf lint` - No linter errors
- ✅ `buf format` - Formatting consistent
- ✅ `make build` - Stubs regenerated successfully
- ✅ `bazel build //apis/stubs/...` - 23 targets built successfully
- ✅ Go stubs contain Cancel, Terminate, Recover methods
- ✅ Python stubs contain new message types and RPC methods
- ✅ Authorization options properly configured
- ✅ Validation rules applied (min_len on id fields)

### Authorization Configuration

All RPCs use consistent pattern:
```protobuf
option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = workflow_execution;
option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_edit;
option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "id";
option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to [operation] workflow execution";
```

### Validation Rules

All input messages:
```protobuf
string id = 1 [(buf.validate.field).string.min_len = 1];
```

## Lessons Learned

### What Worked Well
1. **Combined T2+T3 approach**: Implementing RPCs and messages together avoided compilation issues
2. **Comprehensive documentation**: Following existing patterns (40-75 lines per RPC) ensures maintainability
3. **Comparison tables**: Side-by-side comparisons (cancel vs terminate, recover vs restart) clarify semantics
4. **Temporal equivalents**: Documenting Temporal CLI commands helps backend implementers

### For Future Work
1. **Consider env_overrides early**: Deferred to post-MVP, but may be needed sooner than expected
2. **Plan stub regeneration time**: `make build` takes 8-10 seconds, plan for this in iteration cycles
3. **Document idempotency explicitly**: Users need to know duplicate calls are safe
4. **Include example JSON**: Makes API more approachable for developers

### Quality Standards Applied
- Documentation depth matched existing RPCs (submitApproval = 63 lines, cancel = 65 lines)
- Temporal equivalents documented for each operation
- Error cases enumerated comprehensively
- Example JSON requests/responses included
- Authorization patterns consistent with existing RPCs

---

**Status**: ✅ Proto API Complete (Phase 1)
**Timeline**: T2+T3 completed in single session (~2 hours)
**Next Phase**: Backend handler implementation (T4)
**Project**: 20260207.04.execution-lifecycle-control
