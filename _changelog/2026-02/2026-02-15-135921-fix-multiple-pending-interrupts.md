# Fix Multiple Pending Interrupts Crash (Batch Approval)

**Date**: February 15, 2026

## Summary

Fixed a critical bug where agent executions would crash with "When there are multiple pending interrupts, you must specify the interrupt id when resuming" when the LLM issued multiple tool calls requiring approval in a single response. The fix implements **batch approval** by tracking all pending interrupts with their LangGraph-assigned IDs and resuming the graph with a single `Command(resume={id_A: decision_A, id_B: decision_B, ...})` call, preventing repeated node re-execution and idempotency issues.

## Problem Statement

When the LLM generated multiple tool calls that each required human approval (e.g., writing both `SKILL.md` and `LICENSE.txt`), LangGraph would create one `interrupt()` per tool. However, the system was designed assuming only one pending approval at a time:

1. **StatusBuilder** tracked a single `_pending_tool_approval` and overwrote it when a second approval arrived
2. **Proto definition** (`PendingApproval`) lacked an `interrupt_id` field to map decisions to specific LangGraph interrupts
3. **Resume logic** called `Command(resume=decision)` without specifying which interrupt to resume
4. **Workflow** collected only one approval signal before attempting to resume the graph

This caused LangGraph to raise: `"When there are multiple pending interrupts, you must specify the interrupt id when resuming."`

### Pain Points

- Agent executions failed immediately when multiple approvals were needed
- Users saw duplicate approval prompts for the same file, then a crash
- No way to resume the graph with multiple concurrent interrupts
- Single-approval assumption was baked into proto schema, backend state tracking, workflow orchestration, and CLI rendering
- Idempotency risk: one-at-a-time resume would re-execute already-approved tools

## Solution

Implemented **batch approval** across the entire stack:

### Architecture

1. **Proto Schema Enhancement**
   - Added `interrupt_id` field to `PendingApproval` message
   - Added `repeated PendingApproval pending_approvals` to `AgentExecutionStatus`
   - Preserved singular `pending_approval` for backward compatibility

2. **Post-Stream Interrupt Capture**
   - After the event stream ends in `WAITING_FOR_APPROVAL`, query `agent_graph.get_state(config).interrupts`
   - Match each `Interrupt` to its tool call by `tool_name`
   - Populate `pending_approvals` with all interrupt IDs and tool metadata

3. **Batch Resume Logic**
   - Build `Command(resume={interrupt_id_A: decision_A, interrupt_id_B: decision_B, ...})`
   - Resume the graph ONCE with ALL decisions, avoiding repeated node re-execution
   - Fall back to legacy `Command(resume=decision)` for single-interrupt scenarios

4. **Backend State Tracking**
   - `StatusBuilder` tracks a list of pending run_ids (`_pending_tool_approvals`)
   - `set_tool_approval_decision()` removes only the specific run_id from the list
   - Keeps `WAITING_FOR_APPROVAL` phase until ALL decisions are collected

5. **Workflow Signal Collection**
   - Temporal workflow counts `len(pending_approvals)` to determine how many signals to collect
   - Blocks on receiving ALL approval signals before re-invoking the Python activity
   - Short-circuits on REJECT (fails immediately without waiting for remaining approvals)

6. **CLI Batch Prompting**
   - Iterates over ALL entries in `pending_approvals` from a single stream update
   - Prompts user for each tool before returning to `stream.Recv()`
   - Falls back to legacy one-at-a-time path for backward compatibility

## Implementation Details

### Proto Changes

```proto
message PendingApproval {
  // ... existing fields ...
  
  // LangGraph interrupt ID for targeted resume
  string interrupt_id = 9;
}

message AgentExecutionStatus {
  // ... existing fields ...
  
  // DEPRECATED: Use pending_approvals for new code
  PendingApproval pending_approval = 13;
  
  // All pending approval requests (batch)
  repeated PendingApproval pending_approvals = 16;
}
```

### Python Backend (execute_graphton.py)

**Post-stream interrupt capture** (after event loop ends):

```python
if status_builder.current_status.phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
    graph_state = await agent_graph.aget_state(config)
    
    if graph_state and graph_state.interrupts:
        pending_approvals: list[PendingApproval] = []
        
        for intr in graph_state.interrupts:
            # Match interrupt to tool call by tool_name
            # Build PendingApproval with interrupt_id
            pa = PendingApproval(
                tool_call_id=matched_tool_call_id,
                tool_name=tool_name,
                message=message,
                args_preview=args_preview,
                interrupt_id=intr.id,
                # ... other fields ...
            )
            pending_approvals.append(pa)
        
        # Populate repeated field + backward-compat singular field
        status_builder.current_status.pending_approvals.extend(pending_approvals)
        status_builder.current_status.pending_approval.CopyFrom(pending_approvals[0])
```

**Resume logic**:

```python
# Build dict mapping interrupt_id -> decision
resume_dict: dict[str, dict[str, str]] = {}

for pa in execution.status.pending_approvals:
    approval_action = # ... look up decision from tool calls ...
    decision_value = {"action": action_str, "approved_by": approved_by}
    resume_dict[pa.interrupt_id] = decision_value

graph_input = Command(resume=resume_dict)
```

### StatusBuilder (Python)

**Tracking multiple pending approvals**:

```python
# Track ALL pending run_ids, not just one
self._pending_tool_approvals: list[str] = []

def set_tool_waiting_approval(self, run_id, ...):
    # Append instead of overwrite
    self._pending_tool_approvals.append(run_id)
    self._pending_tool_approval = run_id  # Backward compat

def set_tool_approval_decision(self, run_id, action, ...):
    # Remove only this run_id from the list
    self._remove_from_pending(run_id)
    # Phase stays WAITING_FOR_APPROVAL until list is empty

def _remove_from_pending(self, run_id):
    if run_id in self._pending_tool_approvals:
        self._pending_tool_approvals.remove(run_id)
    
    if not self._pending_tool_approvals:
        # All decided — clear state and restore phase
        self.clear_pending_approval()
```

### Go Workflow (invoke_workflow_impl.go)

**Collecting all approval signals**:

```go
pendingApprovals := finalStatus.GetPendingApprovals()
signalsNeeded := len(pendingApprovals)
if signalsNeeded == 0 {
    signalsNeeded = 1  // Legacy path
}

// Collect ALL signals before resuming
for i := 0; i < signalsNeeded; i++ {
    approvalInput, err := w.waitForApprovalSignal(ctx, executionID)
    // ... embed decision into execution ...
    
    if approvalInput.GetAction() == APPROVAL_ACTION_REJECT {
        break  // Short-circuit on reject
    }
}

// Re-invoke Python activity with all decisions
finalStatus, err = executeGraphtonActivity.ExecuteGraphton(currentExecution, threadID)
```

### Go Service Handler (submit_approval.go)

**Validation against pending_approvals**:

```go
// Batch path: tool_call_id must match ANY entry in pending_approvals
if len(pendingApprovals) > 0 {
    found := false
    for _, pa := range pendingApprovals {
        if pa.GetToolCallId() == requestedToolCallId {
            found = true
            break
        }
    }
    if !found {
        return InvalidArgumentError("tool_call_id not found in pending_approvals")
    }
}
```

### CLI (run_stream_events.go)

**Prompting for all pending approvals in one batch**:

```go
if pendingApprovals := execution.Status.GetPendingApprovals(); len(pendingApprovals) > 0 {
    // Iterate ALL pending approvals from this stream update
    for _, pa := range pendingApprovals {
        if pa.ToolCallId == "" || promptedIDs[pa.ToolCallId] {
            continue
        }
        tc := findToolCallByID(execution.Status.ToolCalls, pa.ToolCallId)
        emitAndWaitApproval(ctx, cfg, tc, pa, promptedIDs)
    }
} else {
    // Legacy path: one-at-a-time
    // ...
}
```

## Benefits

### Immediate Impact

- **Execution stability**: Agent executions no longer crash when multiple tools require approval
- **Better UX**: Users see all pending approvals upfront and resolve them in sequence
- **Idempotency safety**: Graph resumes once with all decisions, not repeatedly for each approval

### Performance

- Reduced graph re-execution: One resume cycle instead of N (where N = number of approvals)
- Faster approval flow: Backend waits for all decisions before resuming, avoiding workflow round-trips

### Maintainability

- Clean separation: Batch path is primary, legacy path is fallback
- Backward compatible: Older CLIs still work with singular `pending_approval`
- Extensible: Foundation for future batch operations (bulk approve/reject)

## Impact

### Who Is Affected

- **End users**: Can now use agents that issue multiple approval-required tool calls
- **Developers**: Can rely on approval system for complex multi-tool operations
- **Platform**: Eliminates a critical crash scenario in the HITL approval flow

### System Components Modified

- **Proto schema**: `api.proto` and generated stubs (Go, Python)
- **Python backend**: `execute_graphton.py`, `status_builder.py`
- **Go backend**: `submit_approval.go`, `invoke_workflow_impl.go`
- **CLI**: `run_stream_events.go`

### Deployment Considerations

- **Rollout**: Backend and CLI must be deployed together for full batch support
- **Backward compatibility**: Older CLIs see only the first pending approval (degraded UX but functional)
- **Database**: No migration needed (proto fields are additive)

## Testing

### Manual Verification

Tested scenario:
1. LLM issues two `write` tool calls in one response (`SKILL.md` + `LICENSE.txt`)
2. Both require approval
3. Backend captures 2 pending interrupts with distinct `interrupt_id`s
4. CLI prompts for both approvals
5. Workflow waits for both signals
6. Python resumes with `Command(resume={id_A: decision_A, id_B: decision_B})`
7. Graph executes both tools once and continues

**Result**: ✅ Execution completes without crash

### Automated Tests

- All 32 existing CLI approval tests pass
- Go backend compiles cleanly
- Python backend compatible (no type errors)

## Related Work

- **Plan**: `.cursor/plans/fix_multiple_interrupts_bug_1db41ae2.plan.md`
- **Original error report**: `_cursor/error.md`
- **LangGraph v0.4+ docs**: Multiple interrupt resume feature
- **Idempotency concern**: Discussed in plan — batch resume avoids repeated tool execution

## Technical Decisions

### Why Batch Resume?

**Alternative considered**: One-at-a-time resume (resume interrupt A, wait for B to re-interrupt)

**Chosen approach**: Collect all decisions, resume once with `{id_A: val_A, id_B: val_B}`

**Rationale**:
- **Idempotency**: Tools node re-executes from start on each resume. One-at-a-time would run Tool A twice (once approved, once when resuming for Tool B)
- **Cleaner semantics**: Graph sees all decisions at once, not a sequence of partial states
- **Performance**: Single graph invocation vs N invocations

### Why Post-Stream Capture?

The interrupt IDs are only available in `graph.get_state().interrupts` AFTER the stream ends. During the stream, we only receive tool call events, which don't include LangGraph's internal interrupt IDs. This necessitates a post-stream query to reconcile tool calls with their interrupt IDs.

### Why Keep Singular Field?

Preserved `pending_approval` (singular) for:
- **Backward compatibility**: Older CLIs expect a single field
- **Transition period**: Allows gradual migration
- **Database stability**: Avoids breaking existing queries or indices

## Future Enhancements

### Batch Approval UX

- "Approve All" button in CLI
- Bulk decision API (`SubmitBatchApproval` RPC)
- Approval preview table (show all pending before prompting)

### Approval Policies

- Auto-approve certain tool combinations
- Risk scoring for batch approvals
- Time-based auto-rejection (if no decision within N minutes)

### Monitoring

- Metrics: average batch size, approval latency per batch
- Alerts: high reject rate, stuck approvals

---

**Status**: ✅ Production Ready

**Timeline**: Single session implementation (Feb 15, 2026)

**Files Modified**: 16 files, +1033/-220 lines

**Risk Level**: Medium
- Core HITL approval flow modified
- Extensive backward compatibility added
- Tested manually and via existing test suite

**Rollback**: Revert commit will restore single-approval behavior (functional but degrades UX for multi-tool scenarios)
