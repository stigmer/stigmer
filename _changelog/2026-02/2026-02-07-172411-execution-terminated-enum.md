# Add EXECUTION_TERMINATED Phase for Force-Stop Workflows

**Date**: February 7, 2026

## Summary

Added `EXECUTION_TERMINATED = 6` to the workflow execution lifecycle enum, establishing the foundational type for the terminate operation. This enum value represents force-stopped workflows that are killed immediately without cleanup opportunity, distinct from graceful cancellation.

## Problem Statement

The durable workflows initiative requires user-facing lifecycle control operations, including the ability to force-stop stuck or unresponsive workflows. The existing lifecycle phases (PENDING, IN_PROGRESS, COMPLETED, FAILED, CANCELLED) lacked a semantic representation for "hard stop" scenarios where workflows are terminated immediately without cleanup.

### Pain Points

- No way to distinguish between graceful stops (CANCELLED) and forced kills
- Missing semantic type for terminate operation (needed for T2 RPC implementation)
- Incomplete audit trail for emergency workflow terminations
- No enum value for workflows that cannot be recovered due to abrupt termination

## Solution

Added `EXECUTION_TERMINATED` as a new terminal state in the `ExecutionPhase` enum with comprehensive documentation explaining:
- Semantic distinction from CANCELLED (hard stop vs graceful)
- Terminal state behavior (cannot be recovered)
- State changes when reached (completed_at, error, abrupt task stops)
- Use cases (stuck workflows, resource consumption, infinite loops)

## Implementation Details

### Proto Changes

**File**: `apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto`

1. **Updated Header Documentation**:
   - Added termination flow diagram: `PENDING/IN_PROGRESS → EXECUTION_TERMINATED`
   - Updated terminal states list to include `EXECUTION_TERMINATED`

2. **Updated Phase Transition Comments**:
   - `EXECUTION_PENDING`: Added `EXECUTION_TERMINATED` to next phases
   - `EXECUTION_IN_PROGRESS`: Added `EXECUTION_TERMINATED` to next phases

3. **Added Enum Value**:
   ```protobuf
   // Execution was force-stopped immediately.
   //
   // Unlike CANCELLED (graceful stop with cleanup opportunity), TERMINATED
   // means the workflow was killed immediately without giving workflow code
   // a chance to clean up. This is used for stuck or unresponsive workflows.
   //
   // Terminal state - execution will not change phases again.
   //
   // When this phase is reached:
   // - completed_at timestamp is set
   // - error field may contain termination reason
   // - In-progress tasks are stopped abruptly
   // - No cleanup callbacks are executed
   //
   // Use Cases:
   // - Force-stop stuck workflows that don't respond to cancellation
   // - Emergency stop for workflows consuming excessive resources
   // - Kill workflows with infinite loops or deadlocks
   //
   // Terminated vs Cancelled:
   // - Terminated: Immediate kill, no cleanup, use when workflow is unresponsive
   // - Cancelled: Graceful stop, cleanup allowed, use when you want controlled shutdown
   //
   // Recovery:
   // - Terminated executions CANNOT be recovered (unlike FAILED)
   // - Use terminate only when cancel doesn't work
   EXECUTION_TERMINATED = 6;
   ```

### Generated Stubs

Successfully regenerated:
- **Go stubs**: `ExecutionPhase_EXECUTION_TERMINATED = 6` constant with full documentation
- **Python stubs**: `EXECUTION_TERMINATED` type annotation and constant
- **Bazel build**: All 23 targets compiled successfully

### Intentionally Deferred

- **CLI display function** (`run_display.go`): Will be updated in T5 with terminate command
- **Test helpers** (`approval_test_helpers.go`): Will be updated when terminate functionality exists
- **agentexecution enum**: Deferred per user decision to separate task

## Benefits

- **Clear semantic distinction**: Terminated vs Cancelled is now explicit in the type system
- **Audit trail support**: Terminated executions can be tracked separately from graceful cancellations
- **Recovery clarity**: Documentation makes it clear that terminated executions cannot be recovered
- **Foundation for T2**: The terminate RPC can now reference this enum value

## Impact

**Protocol Buffers**:
- All client stubs (Go, Python) now include the new enum value
- Backward compatible (additive change only)
- No breaking changes to existing API contracts

**Development**:
- Enables T2 (add terminate RPC) to proceed
- Establishes semantic vocabulary for force-stop operations
- Provides documentation for future maintain developers

**Operations**:
- When terminate operation is implemented (T4), operators will have clear semantic indicator
- Monitoring systems can distinguish terminated from cancelled workflows

## Related Work

**Project**: `20260207.04.execution-lifecycle-control`

**Task Sequence**:
- ✅ **T0**: Removed WorkflowRunner gRPC interface (completed)
- ✅ **T1**: Add EXECUTION_TERMINATED enum (this changelog)
- **T2**: Add cancel/terminate/recover RPCs (next)
- **T3**: Add IO messages
- **T4**: Implement backend handlers
- **T5**: Add CLI commands
- **T6-T7**: Enhanced wait functionality

**Research Foundation**:
- ChatGPT Report 07: Recommended terminate as baseline operation
- Temporal alignment: Maps to `workflow terminate` command
- Industry standard: All major workflow platforms expose terminate operation

---

**Status**: ✅ Production Ready  
**Task**: T1 of execution lifecycle control project
