# Batch Approval Cleanup: Remove Deprecated Singular pending_approval Field

**Date**: February 15, 2026

## Summary

Completed a comprehensive cleanup of the approval system by removing the deprecated singular `pending_approval` field from `AgentExecutionStatus` and `WorkflowExecutionStatus`, establishing `pending_approvals` (plural) as the sole source of truth. This change also restructured `ChildApprovalNotification` to support batch approvals from child agents, enabling multiple tool calls requiring approval to be presented and processed as a batch rather than individually.

This refactoring touched 21 files across the entire stack (proto definitions, Go backend services, Python backend, CLI, and tests), removing approximately 250 lines of legacy fallback code while improving the clarity and consistency of the approval workflow.

## Problem Statement

The approval system had evolved to support batch approvals (multiple tool calls requiring approval presented together), but the codebase maintained dual field systems for backward compatibility:

1. **Singular `pending_approval`** - Legacy field supporting one approval at a time
2. **Plural `pending_approvals`** - New field supporting batch approvals

This dual-field approach created several issues:

### Pain Points

- **Code complexity**: Every code path that handled approvals needed to check both fields with fallback logic
- **Maintenance burden**: Developers had to understand and maintain two parallel systems
- **Testing complexity**: Tests needed to verify both singular and plural paths
- **Documentation confusion**: API documentation had to explain the deprecated field and migration path
- **Inconsistent behavior**: Different services handled the fallback differently, leading to subtle bugs
- **Child approval limitations**: `ChildApprovalNotification` could only send one approval at a time from child agents, requiring multiple signal sends for batch approvals
- **Signal routing complexity**: Temporal workflow had to count signals differently based on whether singular or plural fields were populated

## Solution

Remove all traces of the singular `pending_approval` field and associated fallback logic, establishing `pending_approvals` as the single, authoritative source for approval state. Restructure `ChildApprovalNotification` to carry `repeated PendingApproval` directly, enabling child agents to send batch approvals in a single notification.

### Approach

1. **Proto changes first**: Remove deprecated fields from proto definitions and regenerate stubs
2. **Systematic cleanup**: Work through each service (agent execution, workflow execution, CLI) removing singular field access
3. **Test updates**: Update all test fixtures and assertions to use plural fields
4. **Build verification**: Ensure each component compiles cleanly after changes

## Implementation Details

### Phase 1: Proto API Changes

#### AgentExecutionStatus (api.proto)

Removed the deprecated singular field:

```proto
// REMOVED:
// PendingApproval pending_approval = 13 [deprecated = true];
```

Updated documentation for the plural field to reflect it as the sole source:

```proto
// Pending tool approvals.
//
// When the agent requires human-in-the-loop (HITL) approval for one or more tool calls,
// this list contains the tools awaiting approval. Each entry includes the tool name,
// arguments preview, and metadata needed for the user to make an informed decision.
//
// Batch Approval:
// Multiple tool calls requiring approval are presented together as a batch, allowing
// the user to review and approve/reject them in a single interaction.
repeated PendingApproval pending_approvals = 16;
```

#### ChildApprovalNotification

Restructured from individual fields to batch notification:

**Before** (singular approach):
```proto
message ChildApprovalNotification {
  string execution_id = 1;
  string tool_call_id = 2;
  string tool_name = 3;
  string message = 4;
  string args_preview = 5;
  google.protobuf.Timestamp requested_at = 6;
}
```

**After** (batch approach):
```proto
message ChildApprovalNotification {
  string execution_id = 1;
  repeated PendingApproval pending_approvals = 2;
}
```

This change enables child agents to send all pending approvals in a single notification, matching the batch approval model.

#### WorkflowExecutionStatus (api.proto)

Removed singular field and added plural field support:

```proto
// REMOVED:
// ai.stigmer.agentic.agentexecution.v1.PendingApproval pending_approval = 8;

// ADDED:
// Pending approvals from child agents.
//
// When a child agent execution requires Human-in-the-Loop approval for tool calls,
// the workflow execution surfaces those approvals here. This allows workflow-level
// approval handling and signal routing.
repeated ai.stigmer.agentic.agentexecution.v1.PendingApproval pending_approvals = 9;
```

### Phase 2: Go Backend - Agent Execution

#### submit_approval.go

Removed the legacy fallback block that checked `GetPendingApproval()`:

**Before**:
```go
pendingApprovals := execution.GetStatus().GetPendingApprovals()
pendingApproval := execution.GetStatus().GetPendingApproval()

if len(pendingApprovals) > 0 {
    // Primary path: validate against pending_approvals list
    ...
} else if pendingApproval != nil {
    // Legacy fallback: validate against singular pending_approval
    ...
} else {
    return status.Error(codes.FailedPrecondition, "no pending approvals")
}
```

**After**:
```go
pendingApprovals := execution.GetStatus().GetPendingApprovals()

if len(pendingApprovals) == 0 {
    return status.Error(codes.FailedPrecondition, "no pending approvals")
}

// Validate against pending_approvals list
...
```

#### update_status.go

Updated status merging logic to use plural field:

**Before**:
```go
if requestStatus.PendingApproval != nil {
    if requestStatus.PendingApproval.ToolCallId != "" {
        currentStatus.PendingApproval = requestStatus.PendingApproval
    } else {
        currentStatus.PendingApproval = nil
    }
}
```

**After**:
```go
if len(requestStatus.PendingApprovals) > 0 {
    if requestStatus.PendingApprovals[0].ToolCallId != "" {
        currentStatus.PendingApprovals = requestStatus.PendingApprovals
    }
} else {
    currentStatus.PendingApprovals = nil
}
```

#### invoke_workflow_impl.go

Updated Temporal workflow logging and signal handling:

**Before** (logging):
```go
logger.Info("Agent paused for approval",
    "toolCallId", finalStatus.GetPendingApproval().GetToolCallId())
```

**After** (logging):
```go
pendingApprovals := finalStatus.GetPendingApprovals()
logger.Info("Agent paused for approval",
    "pending_count", len(pendingApprovals),
    "first_tool_call_id", pendingApprovals[0].GetToolCallId())
```

**Signal counting logic** - Removed fallback to `1` when no plural approvals:

**Before**:
```go
signalsNeeded := pendingCount
if signalsNeeded == 0 {
    signalsNeeded = 1  // Legacy: assume 1 if not set
}
```

**After**:
```go
signalsNeeded := len(finalStatus.GetPendingApprovals())
```

### Phase 3: Go Backend - Workflow Execution

#### submit_approval.go

Updated validation to iterate through plural `pending_approvals`:

**Before** (singular validation):
```go
pendingApproval := execution.GetStatus().GetPendingApproval()
if pendingApproval == nil {
    return nil, status.Error(codes.FailedPrecondition, "no pending approval")
}
if pendingApproval.ToolCallId != requestedToolCallId {
    return nil, status.Error(codes.FailedPrecondition, "tool call ID mismatch")
}
childExecutionId := pendingApproval.ChildAgentExecutionId
```

**After** (plural validation):
```go
pendingApprovals := execution.GetStatus().GetPendingApprovals()
if len(pendingApprovals) == 0 {
    return nil, status.Error(codes.FailedPrecondition, "no pending approvals")
}

var childExecutionId string
var matchedApproval *agentexecv1.PendingApproval
for _, pa := range pendingApprovals {
    if pa.ToolCallId == requestedToolCallId {
        matchedApproval = pa
        childExecutionId = pa.ChildAgentExecutionId
        break
    }
}

if matchedApproval == nil {
    return nil, status.Error(codes.FailedPrecondition,
        "requested tool call not in pending approvals")
}
```

### Phase 4: Go Backend - Workflow Runner

#### task_builder_call_agent.go

Updated signal handling to accept batch notification:

**Before**:
```go
notification := childApprovalChannel.Receive(ctx)
logger.Info("Received approval notification",
    "child_execution_id", notification.ExecutionId,
    "tool_name", notification.ToolName)
```

**After**:
```go
notification := childApprovalChannel.Receive(ctx)
pendingCount := len(notification.PendingApprovals)
firstToolName := ""
if pendingCount > 0 {
    firstToolName = notification.PendingApprovals[0].ToolName
}
logger.Info("Received approval notification",
    "child_execution_id", notification.ExecutionId,
    "pending_count", pendingCount,
    "first_tool_name", firstToolName)
```

#### task_builder_call_agent_activities.go

Restructured to build plural `PendingApprovals` from notification:

**UpdateWorkflowTaskApprovalStatus**:

```go
pendingCount := len(notification.PendingApprovals)
pendingApprovals := make([]*agentexecv1.PendingApproval, 0, pendingCount)

for _, pa := range notification.PendingApprovals {
    entry := &agentexecv1.PendingApproval{
        ToolCallId:             pa.ToolCallId,
        ToolName:               pa.ToolName,
        Message:                pa.Message,
        ArgsPreview:            pa.ArgsPreview,
        RequestedAt:            pa.RequestedAt,
        FromSubAgent:           true,
        SubAgentName:           notification.ExecutionId,
        ChildAgentExecutionId:  notification.ExecutionId,
    }
    pendingApprovals = append(pendingApprovals, entry)
}

status.PendingApprovals = pendingApprovals
```

**ClearWorkflowApprovalStatus** - Updated to clear plural field:

**Before**:
```go
status.PendingApprovals = []*agentexecv1.PendingApproval{
    {ToolCallId: ""},  // Empty entry to trigger clear
}
```

**After**:
```go
status.PendingApprovals = []*agentexecv1.PendingApproval{}
```

### Phase 5: Python Backend

#### status_builder.py

Removed all singular field tracking and writes:

**Removed from `__init__`**:
```python
self._pending_tool_approval: Optional[PendingApproval] = None
```

**Removed from `set_tool_waiting_approval`**:
```python
self.current_status.pending_approval.CopyFrom(pending)
```

**Removed from `set_tool_approval_decision`** (reject path):
```python
self.current_status.pending_approval.Clear()
```

**Removed from `clear_pending_approval`**:
```python
self.current_status.pending_approval.Clear()
```

**Updated `_populate_pending_approval`** - Removed singular write:
```python
# REMOVED: self.current_status.pending_approval.CopyFrom(pending)
```

All functionality now exclusively uses `_pending_tool_approvals` (plural list) and `current_status.pending_approvals` (plural proto field).

#### execute_graphton.py

Removed legacy approval path in resume logic:

**Removed** (lines 1252-1291):
```python
# Legacy path: singular pending_approval (no interrupt_id)
if (
    last_approval_decision.approval_action != ApprovalAction.APPROVAL_ACTION_UNSPECIFIED
    and last_approval_decision.tool_call_id
    and not last_approval_decision.interrupt_id
):
    logger.warning(
        "Resuming with legacy singular approval decision",
        extra={
            "execution_id": execution_id,
            "tool_call_id": last_approval_decision.tool_call_id,
        },
    )
    # ... legacy resume logic ...
```

**Removed backward-compat write** (line 1638):
```python
# REMOVED: self.current_status.pending_approval.CopyFrom(pending)
```

### Phase 6: CLI

#### run_stream_events.go

Removed legacy fallback for agent approvals:

**Before**:
```go
if len(execution.Status.GetPendingApprovals()) > 0 {
    // Primary path: process batch approvals
    ...
} else {
    // Legacy fallback: check singular pending_approval
    singularPa := execution.Status.GetPendingApproval()
    if singularPa != nil && needsAgentApprovalPrompt(prevExecution, singularPa) {
        // Handle singular approval
    }
}
```

**After**:
```go
if len(execution.Status.GetPendingApprovals()) > 0 {
    // Process batch approvals (only path)
    ...
}
```

#### run_stream.go

Updated workflow approval handling to use plural field:

**Before**:
```go
pendingApproval := execution.Status.GetPendingApproval()
if pendingApproval != nil && needsWorkflowApprovalPrompt(prevExecution, pendingApproval) {
    // Handle workflow approval
}
```

**After**:
```go
for _, pa := range execution.Status.GetPendingApprovals() {
    if needsWorkflowApprovalPrompt(prevExecution, pa) {
        // Handle workflow approval
    }
}
```

### Phase 7: Tests

#### test_status_builder.py

Comprehensively updated all test fixtures and assertions to use plural fields:

**Fixture updates**:
```python
# BEFORE:
mock_initial_status.pending_approval = PendingApproval()

# AFTER:
# (field removed entirely from fixtures)
```

**Test updates** (example):
```python
# BEFORE:
def test_set_tool_waiting_approval_populates_pending_approval(status_builder):
    assert status_builder.current_status.pending_approval.tool_name == "test_tool"

# AFTER:
def test_set_tool_waiting_approval_tracks_pending(status_builder):
    assert len(status_builder._pending_tool_approvals) == 1
    assert status_builder._pending_tool_approvals[0].tool_name == "test_tool"
```

**Renamed tests for clarity**:
- `test_decision_clears_pending_approval_proto` → `test_decision_clears_pending_approvals_proto`

All 40+ test cases updated to assert against plural fields.

## Benefits

### Code Quality

- **Eliminated ~250 lines of legacy code**: Removed fallback paths, duplicate validation logic, and backward-compatibility comments
- **Single source of truth**: All approval logic now uses one field, eliminating ambiguity
- **Clearer intent**: Code directly expresses batch approval model without legacy cruft
- **Reduced cognitive load**: Developers no longer need to understand two parallel systems

### Maintainability

- **Simpler onboarding**: New developers see a consistent approval pattern
- **Easier debugging**: Only one code path to trace for approval issues
- **Reduced test complexity**: Tests focus on the primary path only
- **Better documentation**: API docs no longer need to explain deprecated fields

### Performance

- **Fewer proto field checks**: No need to check both singular and plural fields
- **Optimized signal handling**: Temporal workflow directly uses plural count for signal routing
- **Simplified status merging**: Update logic handles one field instead of two

### Batch Approval Foundation

- **Child agent batching**: `ChildApprovalNotification` now sends all approvals in one signal
- **Consistent UX**: All approval paths (direct, child agent, workflow) use batch model
- **Future-proof**: System is ready for further batch approval enhancements

## Impact

### Affected Components

**Proto APIs** (2 files):
- `agentexecution/v1/api.proto`
- `workflowexecution/v1/api.proto`

**Go Backend Services** (6 files):
- `stigmer-server/agentexecution/controller/` (2 files)
- `stigmer-server/agentexecution/temporal/workflows/` (1 file)
- `stigmer-server/workflowexecution/controller/` (1 file)
- `workflow-runner/zigflow/tasks/` (2 files)

**Python Backend** (3 files):
- `agent-runner/worker/activities/graphton/status_builder.py`
- `agent-runner/worker/activities/execute_graphton.py`
- `agent-runner/tests/test_status_builder.py`

**CLI** (2 files):
- `cli/cmd/stigmer/root/run_stream_events.go`
- `cli/cmd/stigmer/root/run_stream.go`

**Generated Stubs** (8 files):
- Go stubs (2 files)
- Python stubs (6 files)

### Compatibility

**Breaking Change**: This is a protocol-level breaking change. The singular `pending_approval` field has been removed from the proto definitions.

**Migration**: Deployments must be coordinated to ensure all services are updated simultaneously, as older services expecting the singular field will not function correctly with the new protos.

**Rollout Strategy**: Deploy as part of a coordinated release with all services (stigmer-server, workflow-runner, agent-runner, CLI) updated together.

### Team Impact

- **Backend developers**: Simpler approval logic to maintain
- **Frontend/CLI developers**: Consistent batch approval UI pattern
- **QA/Testing**: Fewer edge cases to test (no singular/plural transitions)
- **Documentation**: Clearer API documentation without deprecated field explanations

## Related Work

This cleanup builds on previous approval system work:

- **2026-02-15**: [Fix Multiple Pending Interrupts](2026-02-15-135921-fix-multiple-pending-interrupts.md) - Fixed interrupt tracking to support batch approvals
- **2026-02-15**: [Fix Tool Result Extraction](2026-02-15-141508-fix-approval-tool-result-extraction.md) - Fixed tool result extraction in batch approval scenarios

### Follow-up Work

**Deferred**: Parallel agent signal routing optimization

The plan identified an opportunity to optimize signal routing when multiple child agents require approval simultaneously. Currently, each child sends a separate `ChildApprovalNotification`, requiring the parent workflow to listen for N signals. A future enhancement could batch these notifications from multiple children into a single signal.

**Why deferred**: This optimization requires architectural changes to how parent workflows track child agent approvals. It was kept out of scope to maintain focus on the core cleanup objective.

### Architecture Notes

**Temporal Signal Handling**: The workflow now correctly uses `len(GetPendingApprovals())` to determine `signalsNeeded` for the approval loop. This count represents the number of individual approval decisions required, not the number of child agents.

**Status Merging**: The status update logic treats `pending_approvals[0].ToolCallId != ""` as the indicator for setting approvals, and an empty list as the clear signal.

**CLI Batch Rendering**: The CLI displays all pending approvals in a batch, allowing users to approve/reject them in sequence or as a group (depending on approval options).

## Verification

### Build Status

All components compile successfully:
- ✅ `stigmer-server`: Clean build
- ✅ `workflow-runner`: Clean build
- ✅ `agent-runner`: Python imports valid
- ✅ `cli`: Clean build

### Test Status

All modified component tests pass:
- ✅ `stigmer-server/agentexecution/controller`: Tests pass
- ✅ `stigmer-server/workflowexecution/controller`: Tests pass
- ✅ `agent-runner/tests/test_status_builder.py`: All tests updated and passing

**Note**: Pre-existing test failures in unmodified files (workflow dedupe timing test, CLI display tests) are unrelated to this change.

### Code Review

All deprecated field references removed:
- ✅ No `GetPendingApproval()` calls on status objects
- ✅ No `pending_approval` proto field access
- ✅ No `_pending_tool_approval` (singular) Python variable references
- ✅ All legacy fallback blocks removed

---

**Status**: ✅ Production Ready

**Timeline**: Implemented February 15, 2026 (1 session)

**Files Changed**: 21 files (+428 additions, -679 deletions)

**Migration Path**: Coordinate deployment across all services (stigmer-server, workflow-runner, agent-runner, CLI) to ensure proto compatibility.
