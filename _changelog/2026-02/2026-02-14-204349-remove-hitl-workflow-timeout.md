# Remove HITL Workflow Timeout and Add Stale Execution Reconciliation

**Date**: February 14, 2026

## Summary

Fixed a critical bug where agent executions requiring human approval would become permanently stuck in `WAITING_FOR_APPROVAL` state when users took more than 10 minutes to respond. The fix removes the arbitrary workflow timeout and adds reconciliation logic to clean up stale executions when the backing Temporal workflow terminates unexpectedly.

## Problem Statement

Users reported encountering "workflow not running for execution... - execution may have already completed" errors when submitting approvals for agent tool calls. Investigation revealed that:

1. The Temporal workflow had a 10-minute `WorkflowRunTimeout` that included time spent waiting for human approval
2. When the timeout fired while waiting for approval, Temporal killed the workflow, but no cleanup code ran
3. The execution remained stuck in `WAITING_FOR_APPROVAL` phase in the database forever
4. Subsequent approval submissions failed with "workflow not found" because the workflow was already dead

### Pain Points

- **Broken user experience**: Users who took >10 minutes to review and approve tool calls faced errors and stuck executions
- **Contradicts durable execution promise**: The platform promises durable execution but workflows were timing out arbitrarily
- **No cleanup on unexpected termination**: Infrastructure failures or manual terminations left executions in permanently inconsistent state
- **Same issue in both OSS and Cloud**: Both codebases had identical 10-minute timeout and no reconciliation logic

## Solution

### Two-part fix:

**1. Remove WorkflowRunTimeout entirely**
- Temporal workflows can safely run indefinitely while waiting for signals
- Activity-level timeouts already protect against stuck activities (10-minute activity timeout, 30-second heartbeat)
- Humans may take minutes, hours, or days to respond to approval prompts
- An idle workflow waiting for a signal costs essentially nothing (just a row in Temporal's database)

**2. Add stale execution reconciliation**
- When `SignalWorkflow` detects `WorkflowNotFound` (workflow terminated unexpectedly)
- Update execution status in DB from `WAITING_FOR_APPROVAL` to `FAILED`
- Clear the `pending_approval` field
- Add explanatory system message to the execution
- Best-effort reconciliation: log error if DB update fails but still return gRPC error to caller

## Implementation Details

### Files Changed

**OSS (stigmer/stigmer):**
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflow_creator.go`
  - Removed `WorkflowRunTimeout: 10 * time.Minute` from `StartWorkflowOptions`
  - Removed unused `time` import
  - Added explanatory comment about why no workflow-level timeout is set
  
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/submit_approval.go`
  - Added `store.Store` field to `signalWorkflowStep` struct
  - Updated constructor to accept store parameter
  - Added `reconcileStaleExecution()` method that updates execution to FAILED
  - When `ErrWorkflowNotFound` detected, calls reconciliation before returning error

**Cloud (stigmer-cloud):**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowCreator.java`
  - Removed `.setWorkflowRunTimeout(Duration.ofMinutes(10))` from `WorkflowOptions`
  - Removed unused `java.time.Duration` import
  - Added explanatory comment about why no workflow-level timeout is set

- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionSubmitApprovalHandler.java`
  - Added `AgentExecutionRepo` dependency to `SignalWorkflowStep`
  - Added imports for `AgentExecutionStatus`, `AgentMessage`, `MessageType`
  - Added `reconcileStaleExecution()` method that updates execution to FAILED
  - When `WorkflowNotFoundException` caught, calls reconciliation before returning error

### Technical Decisions

**Why remove timeout instead of increasing it?**
- Any finite timeout (10 minutes, 24 hours, 30 days) is arbitrary and wrong for some use case
- A user who approves after 10 days should have their execution resume correctly
- Temporal is designed for exactly this: long-lived workflows waiting for human signals
- Activity-level timeouts already protect against stuck work

**Why best-effort reconciliation?**
- Reconciliation only runs when a "workflow not found" condition is detected
- This should be rare (infrastructure failures, manual termination)
- If DB update fails, execution remains stale but we still inform the user
- Alternative would be a background job scanning for stale executions (overkill for rare case)

## Benefits

**Correctness**: Approvals now work regardless of how long the user takes to respond

**Simplicity**: No arbitrary timeout value to configure or reason about

**Reliability**: Unexpected workflow terminations no longer leave permanent database inconsistencies

**Consistency**: Same fix applied to both OSS (Go) and Cloud (Java) codebases

## Impact

**Users**: Human-in-the-loop approval flows now work correctly for any response time

**Operations**: Executions no longer get permanently stuck in `WAITING_FOR_APPROVAL`

**Platform**: Upholds the durable execution promise - executions can pause for days waiting for human input

**Temporal**: Leverages Temporal's design for long-lived workflows (the right abstraction)

## Related Work

This fix directly addresses the root cause observed in the user-reported bug where:
- User triggered an agent execution that required approval
- Agent ran for ~5-7 minutes before reaching the approval point
- User saw the approval prompt in the CLI
- By the time user responded, the 10-minute workflow timeout had fired
- CLI reported "workflow not running" error
- Execution was stuck in `WAITING_FOR_APPROVAL` phase forever

Future work: Consider adding a background reconciliation job that detects executions stuck in `WAITING_FOR_APPROVAL` for >24 hours and queries Temporal to check if workflow still exists (defensive measure).

---

**Status**: ✅ Production Ready
**Timeline**: Diagnosed, planned, and implemented in single session (2026-02-14)
**Applies to**: Both stigmer OSS (Go) and stigmer-cloud (Java)
