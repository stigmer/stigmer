# Working with Agent Execution - Developer Guide

**Audience**: Developers implementing or debugging agent execution workflows  
**Related**: [Agent Execution Workflow Architecture](../architecture/agent-execution-workflow.md)

---

## Quick Start

### Run Locally

**Prerequisites**:
- Temporal server running (localhost:7233)
- MongoDB running
- Redis running
- Auth0 credentials configured

**Start Services**:
```bash
# Terminal 1: stigmer-service
cd backend/services/stigmer-service
./gradlew bootRun

# Terminal 2: agent-runner
cd backend/services/agent-runner
poetry run python main.py
```

**Create Execution**:
```bash
grpcurl -d '{
  "spec": {
    "session_id": "ses_test",
    "agent_id": "agt_test",
    "message": "Hello!"
  }
}' localhost:8080 ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/create
```

---

## Common Tasks

### Adjust Update Frequency

**File**: `worker/activities/execute_graphton.py`

```python
# Change this value:
update_interval = 10  # Send update every N events

# Options:
# - Lower (5): More real-time, more gRPC calls
# - Higher (20): Fewer calls, less real-time  
# - Current (10): Good balance
```

### Add Custom Status Fields

**1. Update Proto** (apis/ai/stigmer/agentic/agentexecution/v1/api.proto):
```protobuf
message AgentExecutionStatus {
  // ... existing fields ...
  string custom_field = 10;  // Add new field
}
```

**2. Update StatusBuilder** (agent-runner/worker/activities/graphton/status_builder.py):
```python
class StatusBuilder:
    def process_event(self, event):
        # ... existing logic ...
        
        # Set custom field
        if event.get("custom_data"):
            self.current_status.custom_field = event["custom_data"]
```

**3. Update Merge Logic** (stigmer-service/.../AgentExecutionUpdateHandler.java):
```java
// In BuildNewStateWithStatusStep
if (!requestStatus.getCustomField().isEmpty()) {
    statusBuilder.setCustomField(requestStatus.getCustomField());
}
```

### Debug Status Updates

**Check Python logs** (agent-runner):
```bash
# Look for these patterns:
📤 Sending status update #10: messages=1, tool_calls=0
✅ Status update sent successfully
```

**Check Java logs** (stigmer-service):
```bash
# Look for these patterns:
Merged status updates: messages=2, tool_calls=1, phase=EXECUTION_IN_PROGRESS
Saved execution aex_xxx to MongoDB
```

**If updates aren't working**:
1. Check gRPC client initialization
2. Verify stigmer-service is accessible (localhost:8080)
3. Check authentication (machine account token)
4. Look for exceptions in Python activity logs

### View in Temporal UI

Navigate to http://localhost:8233

**Find Workflow**:
- Search by execution ID: `aex_xxx`
- Filter by workflow type: `stigmer/agent-execution/invoke`

**What to Check**:
- Did `EnsureThread` complete?
- Did `ExecuteGraphton` complete?
- Are there any failures or retries?
- What was the final return value?

**Note**: Status updates via gRPC won't appear in Temporal UI (they're not Temporal activities).

---

## Troubleshooting

### Status Not Updating

**Symptom**: Execution completes but status remains empty in DB

**Check**:
1. **gRPC client initialized?**
   ```python
   # In execute_graphton.py
   execution_client = AgentExecutionClient(token_manager)
   ```

2. **Updates being sent?**
   ```bash
   # Agent-runner logs should show:
   📤 Sending status update #10
   ```

3. **stigmer-service reachable?**
   ```bash
   # Try:
   curl http://localhost:8080
   ```

4. **Authentication working?**
   ```bash
   # Check for token errors in logs
   ```

**Fix**: Restart both services, ensure token_manager is initialized.

### Updates Too Frequent

**Symptom**: Too many database writes, high CPU

**Solution**: Increase `update_interval`:
```python
update_interval = 20  # Was 10
```

### Updates Too Infrequent

**Symptom**: Frontend feels laggy, updates arrive in batches

**Solution**: Decrease `update_interval`:
```python
update_interval = 5  # Was 10
```

### Workflow Stuck

**Symptom**: Workflow never completes, activities pending

**Check**:
1. **Python worker running?**
   ```bash
   # Agent-runner logs should show:
   Worker ready, polling for tasks...
   ```

2. **Task queue matches?**
   ```yaml
   # Both should use "execution"
   stigmer-service: execution
   agent-runner: execution
   ```

3. **Temporal server running?**
   ```bash
   curl http://localhost:8233
   ```

**Fix**: Ensure both workers are polling the same task queue.

### gRPC Update Fails

**Symptom**: Warnings in logs: `Status update failed: ...`

**Common Causes**:
- stigmer-service not running
- Network issue
- Authentication expired

**Impact**: Execution continues (updates are best-effort), but status may be stale.

**Fix**: Check stigmer-service logs, ensure service is healthy.

---

## Best Practices

### 1. Update Frequency

**Balance real-time vs overhead**:
- Too frequent (every event): High overhead, no benefit
- Too infrequent (every 100 events): Laggy UX
- Sweet spot: Every 5-10 events

### 2. Error Handling

**Always wrap gRPC calls**:
```python
try:
    await execution_client.update(...)
except Exception as e:
    activity_logger.warning(f"Status update failed: {e}")
    # Don't raise - keep processing
```

**Why**: Status updates shouldn't break execution.

### 3. Final Update

**Always send final update**:
```python
# After agent completes
status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED
await execution_client.update(execution_id, status_builder.current_status)
```

**Why**: Ensures frontend knows execution is done.

### 4. Return Status to Workflow

**Always return final status**:
```python
# At end of execute_graphton
return status_builder.current_status
```

**Why**: Temporal UI can show final state, helps debugging.

### 5. Logging

**Log at key points**:
```python
activity_logger.info(f"ExecuteGraphton started for execution: {execution_id}")
activity_logger.debug(f"Sending status update #{events_processed}")
activity_logger.info(f"ExecuteGraphton completed - processed {events_processed} events")
```

**Why**: Makes debugging easier when things go wrong.

---

## Common Patterns

### Batch Multiple Updates

**When**: Lots of small events in quick succession

**Pattern**:
```python
# Accumulate changes
pending_updates = []
last_sent = time.time()

async for event in agent_graph.astream_events(...):
    await status_builder.process_event(event)
    
    # Send every N events OR every N seconds
    if (events_processed % 10 == 0) or (time.time() - last_sent > 2.0):
        await execution_client.update(...)
        last_sent = time.time()
```

### Update on Significant Events

**When**: Only care about major milestones

**Pattern**:
```python
async for event in agent_graph.astream_events(...):
    await status_builder.process_event(event)
    
    # Send update on significant events
    if event_type in ["tool_call_start", "phase_change", "error"]:
        await execution_client.update(...)
```

### Retry Failed Updates

**When**: Network is unreliable

**Pattern**:
```python
async def send_update_with_retry(execution_id, status, max_retries=3):
    for attempt in range(max_retries):
        try:
            await execution_client.update(execution_id, status)
            return
        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
            else:
                activity_logger.warning(f"Failed after {max_retries} attempts: {e}")
```

---

## Testing

### Unit Test Python Activity

```python
# test_execute_graphton.py
import pytest
from worker.activities.execute_graphton import execute_graphton

@pytest.mark.asyncio
async def test_execute_graphton():
    execution = AgentExecution(...)
    thread_id = "test-thread"
    
    status = await execute_graphton(execution, thread_id)
    
    assert status.phase == ExecutionPhase.EXECUTION_COMPLETED
    assert len(status.messages) > 0
```

### Integration Test Full Flow

```python
# test_integration.py
@pytest.mark.asyncio
async def test_full_execution_flow():
    # 1. Create execution via gRPC
    response = await client.create(...)
    execution_id = response.metadata.id
    
    # 2. Wait for completion
    await wait_for_completion(execution_id)
    
    # 3. Verify status in DB
    execution = await client.get(execution_id)
    assert execution.status.phase == ExecutionPhase.EXECUTION_COMPLETED
    assert len(execution.status.messages) > 0
```

---

## Performance Tips

### 1. Reduce Update Frequency

**Impact**: Fewer DB writes, lower CPU

```python
update_interval = 20  # Higher = fewer updates
```

### 2. Batch Status Building

**Impact**: Less object creation overhead

```python
# Build status incrementally, don't recreate
status_builder = StatusBuilder(execution_id, execution.status)
# ... reuse throughout
```

### 3. Connection Pooling

**Impact**: Reuse gRPC connections

```python
# Use singleton client (already implemented)
execution_client = AgentExecutionClient(token_manager)
```

---

## Related Documentation

- [Architecture: Agent Execution Workflow](../architecture/agent-execution-workflow.md)
- [Fix: Progressive Status Updates](../fixes/2026-01-15-implement-progressive-status-updates-via-grpc.md)
- [Temporal Docs](https://docs.temporal.io/)

---

## Summary

**Key Takeaways**:
- ✅ Status updates happen via gRPC during execution
- ✅ Update frequency is configurable (default: every 10 events)
- ✅ Updates are best-effort (don't break execution on failure)
- ✅ Final status always sent + returned to workflow
- ✅ Custom fields require proto + StatusBuilder + merge logic changes

**When in doubt**: Check logs in both services - they'll show you what's happening.
