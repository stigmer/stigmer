# Agent Runner Migration: RPC to Temporal Activity

**Date**: 2026-01-15  
**Status**: Complete - Ready for Testing

---

## Summary

Removed gRPC-based execution status updates from agent-runner and migrated to Temporal activity pattern, completing the polyglot architecture described in the changelog.

---

## What Changed

### Architecture

**Before (WRONG)**:
```
Agent-Runner → gRPC Update RPC → Stigmer-Service Handler → ❌ Status Discarded
```

**After (CORRECT)**:
```
Agent-Runner → Temporal Activity → Stigmer-Service Persistence → ✅ Status Persisted
```

---

## Files Modified

### 1. `worker/activities/execute_graphton.py`

**Changes**:
- ✅ Replaced `execution_client.update_from_event()` with `ExecutionStatusUpdater.process_event()`
- ✅ Added periodic `flush()` calls (every 10 events)
- ✅ Status updates now via Temporal activity (no RPC)
- ✅ Phase updates via status updater instead of RPC
- ✅ Error handling via status updater instead of RPC

**Key Pattern**:
```python
# Initialize status updater with Temporal client
temporal_client = get_temporal_client()
status_updater = ExecutionStatusUpdater(temporal_client)

# Initialize with execution status (execution is the activity input parameter)
status_updater.initialize_for_execution(execution_id, execution.status)

# Process events locally (builds status in memory)
async for event in agent_graph.astream_events(...):
    await status_updater.process_event(event)
    
    # Flush periodically to persist via Temporal activity
    if events_processed % 10 == 0:
        await status_updater.flush()

# Final flush
await status_updater.flush()
```

### 2. `grpc_client/execution_client.py` (DELETED)

**Changes**:
- ✅ Completely removed - no longer needed
- ✅ All update methods removed: `update()`, `update_phase()`, `add_error_message()`
- ✅ All event processing logic moved to `ExecutionStatusUpdater`
- ✅ Command stub removed
- ✅ `get()` method removed (execution is now passed as activity parameter)

**Why Deleted**:
The execution is already provided as input to the `execute_graphton` activity, so there's no need to fetch it via gRPC. This eliminates an unnecessary network call.

### 3. `worker/temporal_client.py` (NEW)

**Purpose**: Global Temporal client accessor for activities

**API**:
```python
def set_temporal_client(client: Client) -> None:
    """Set global Temporal client (called by worker)."""

def get_temporal_client() -> Optional[Client]:
    """Get global Temporal client (used by activities)."""
```

### 4. `worker/worker.py`

**Changes**:
- ✅ Added `set_temporal_client(self.client)` after Temporal connection
- ✅ Import `set_temporal_client` from `worker.temporal_client`

---

## Why This Matters

### Design Compliance

**Spec/Status Separation Maintained**:
- ✅ RPC handles spec updates (user-facing)
- ✅ Activity handles status updates (system-managed)
- ✅ No anti-patterns in codebase

### Performance

- ✅ Single DB query per flush (not per event)
- ✅ Batch updates (flush every 10 events)
- ✅ No multiple findById calls

### Correctness

- ✅ Status updates actually persist (not discarded)
- ✅ Tool calls visible in UI
- ✅ Sub-agent executions tracked
- ✅ Todo lists work

---

## Testing Checklist

### Prerequisites

- [ ] Temporal server running (localhost:7233)
- [ ] stigmer-service running with persistence activity registered
- [ ] MongoDB accessible
- [ ] Redis accessible

### Verification Steps

1. **Start Services**:
   ```bash
   # Terminal 1: stigmer-service
   cd backend/services/stigmer-service
   ./gradlew bootRun
   # Verify: "Registered UpdateExecutionStatusActivity on 'execution-persistence'"
   
   # Terminal 2: agent-runner
   cd backend/services/agent-runner
   poetry run python main.py
   # Verify: "Connected to Temporal server"
   ```

2. **Trigger Execution**:
   - Create execution via API or frontend
   - Monitor logs in both services

3. **Check Temporal UI**:
   - Navigate to http://localhost:8233
   - Find execution workflow
   - Verify `UpdateExecutionStatus` activity appears
   - Check activity input/output

4. **Check Logs**:
   - Agent-runner: Look for "Flushed status to stigmer-service"
   - Stigmer-service: Look for "✅ Activity completed - Updated execution status"

5. **Verify Database**:
   ```javascript
   // MongoDB
   db.agent_executions.findOne(
     {_id: "execution-id"},
     {"status.tool_calls": 1, "status.messages": 1}
   )
   ```

6. **Check Frontend**:
   - Open execution in UI
   - Verify tool calls are visible
   - Verify status updates in real-time

---

## Rollback Plan

If issues arise:

1. **Revert Changes**:
   ```bash
   git revert <commit-hash>
   ```

2. **Temporary Fix** (Not Recommended):
   - Could temporarily re-add update methods to `execution_client.py`
   - But this brings back the original bug (status not persisting)

---

## Known Limitations

### What Still Uses RPC

- ✅ Session operations: `session_client.*`
- ✅ Agent operations: `agent_client.*`
- ✅ Agent instance operations: `agent_instance_client.*`
- ✅ Skill operations: `skill_client.*`
- ✅ Environment operations: `environment_client.*`

**Only status updates** moved to Temporal activity.  
**Execution reads** are now handled via activity input parameter (no gRPC needed).

---

## Success Metrics

After deployment:

### Technical
- ✅ Temporal UI shows `UpdateExecutionStatus` activity executions
- ✅ Agent-runner logs show "Flushed status to stigmer-service"
- ✅ Stigmer-service logs show "✅ Activity completed"
- ✅ MongoDB has complete status data (tool_calls, messages, etc.)

### Functional
- ✅ Tool calls visible in frontend
- ✅ Sub-agent tracking works
- ✅ Todo lists update correctly
- ✅ Real-time status updates work

### Design
- ✅ No RPC calls for status updates
- ✅ Spec/status separation maintained
- ✅ Single DB query per flush (efficient)

---

## Related Documentation

- `_changelog/2026-01/2026-01-15-014705-fix-agent-execution-status-persistence-via-polyglot-temporal.md`
- Stigmer-service: `activities/UpdateExecutionStatusActivity.java`
- Agent-runner: `grpc_client/execution_status_updater.py`

---

## Next Steps

1. **Test Locally**: Follow testing checklist above
2. **Deploy to Dev**: Monitor metrics and logs
3. **Deploy to Prod**: After dev validation
4. **Update Documentation**: Document the polyglot pattern for other services

---

**Key Achievement**: Correct architectural solution that maintains design principles while fixing critical functionality.
