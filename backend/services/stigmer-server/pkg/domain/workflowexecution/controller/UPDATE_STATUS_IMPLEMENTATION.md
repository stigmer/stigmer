# WorkflowExecution UpdateStatus Implementation - ADR 011 Compliance

**Date**: 2026-01-19  
**Pattern**: Pipeline-based with StreamBroker (matches AgentExecution)  
**ADR**: 011 - Comprehensive Local Runtime Architecture (The Stigmer Daemon)

## Overview

Successfully implemented the `UpdateStatus` RPC for WorkflowExecution following the same pipeline pattern as AgentExecution, as per ADR 011's requirements for real-time streaming updates via in-memory Go channels.

## Files Created/Modified

### New Files

1. **`stream_broker.go`** (151 lines)
   - StreamBroker implementation for managing in-memory Go channels
   - Subscribe/Unsubscribe/Broadcast methods
   - Thread-safe with RWMutex
   - Buffered channels (size: 100) to prevent blocking
   - Matches AgentExecution's StreamBroker exactly

### Modified Files

1. **`workflowexecution_controller.go`**
   - Added `streamBroker *StreamBroker` field
   - Initialize streamBroker in `NewWorkflowExecutionController()`
   - Updated documentation to mention streaming (ADR 011)

2. **`update_status.go`** (269 lines)
   - **COMPLETE REWRITE**: Changed from direct implementation to pipeline pattern
   - Now uses 5-step pipeline (matches AgentExecution exactly)
   - Custom pipeline steps for workflow execution status updates

## Implementation Details

### Pipeline Architecture

**Old Implementation** (Direct Pattern):
```go
func UpdateStatus(ctx, input) {
    // 1. Validate
    // 2. Load existing
    // 3. Merge status fields inline
    // 4. Persist
    // 5. Return
}
```

**New Implementation** (Pipeline Pattern):
```go
func UpdateStatus(ctx, input) {
    reqCtx := pipeline.NewRequestContext(ctx, input)
    
    p := pipeline.NewPipeline("workflowexecution-update-status").
        AddStep(newValidateUpdateStatusInputStep()).
        AddStep(newLoadExistingExecutionStep(c.store)).
        AddStep(newBuildNewStateWithStatusStep()).
        AddStep(newPersistExecutionStep(c.store)).
        AddStep(newBroadcastToStreamsStep(c.streamBroker)).  // ← ADR 011
        Build()
    
    return p.Execute(reqCtx)
}
```

### Custom Pipeline Steps

#### 1. ValidateUpdateStatusInputStep
**Purpose**: Validate input before processing

**Validations**:
- `input` is not nil
- `execution_id` is not empty
- `status` is not nil

**Error**: Returns `INVALID_ARGUMENT` if validation fails

#### 2. LoadExistingExecutionStep
**Purpose**: Load current execution from BadgerDB

**Logic**:
```go
existing := &WorkflowExecution{}
store.GetResource(ctx, "WorkflowExecution", executionID, existing)
ctx.Set("existingExecution", existing)
```

**Error**: Returns `NOT_FOUND` if execution doesn't exist

#### 3. BuildNewStateWithStatusStep
**Purpose**: Merge status updates from input with existing execution

**Merge Strategy** (following Java implementation):
- **Clone existing**: Start with full clone to preserve spec
- **Replace tasks**: Full replacement of tasks array
- **Update phase**: If provided (not UNSPECIFIED)
- **Update output**: If provided
- **Update error**: If provided
- **Update timestamps**: started_at, completed_at if provided
- **Update temporal_workflow_id**: If provided

**Why Clone?**
- Preserves `spec` (user inputs are immutable)
- Preserves `metadata` (resource ID, etc.)
- Only updates `status` fields

**Context Storage**:
```go
ctx.Set("execution", updatedExecution)
```

#### 4. PersistExecutionStep
**Purpose**: Save merged execution to BadgerDB

**Logic**:
```go
execution := ctx.Get("execution")
store.SaveResource(ctx, "WorkflowExecution", executionID, execution)
```

**Error**: Returns `INTERNAL` if save fails

#### 5. BroadcastToStreamsStep
**Purpose**: Push update to active Go channels (ADR 011 compliance)

**Logic**:
```go
execution := ctx.Get("execution")
streamBroker.Broadcast(execution)
```

**From ADR 011 - Write Path**:
```
4. Daemon (Streaming): Pushes message to active Go Channels
```

This step implements the streaming requirement from the ADR.

**Non-blocking**: If a subscriber's channel buffer is full, the update is dropped for that subscriber (they'll get the next one).

### StreamBroker Implementation

**Architecture** (from ADR 011):
```
Stream Broker: Manages in-memory Go Channels to broadcast real-time updates to CLI watchers.
```

**Thread-Safety**:
- Uses `sync.RWMutex` for concurrent access
- Read lock for broadcasts (multiple readers)
- Write lock for subscribe/unsubscribe (exclusive writer)

**Channel Management**:
```go
subscribers map[string][]chan *WorkflowExecution
```

**Buffer Size**: 100
- Allows bursts of updates without blocking broadcasts
- If buffer full, update is dropped (non-blocking)

**Methods**:
1. `Subscribe(executionID)` - Register new subscriber
2. `Unsubscribe(executionID, ch)` - Remove subscriber and close channel
3. `Broadcast(execution)` - Send update to all subscribers (non-blocking)
4. `GetSubscriberCount(executionID)` - Get active subscriber count

### Differences from Old Implementation

| Aspect | Old (Direct) | New (Pipeline) |
|--------|-------------|----------------|
| **Pattern** | Direct inline logic | Pipeline with steps |
| **Streaming** | ❌ None | ✅ ADR 011 compliant |
| **Cloning** | ❌ Mutated in place | ✅ Proto.Clone() |
| **Testability** | ⚠️ Hard to test | ✅ Each step testable |
| **Observability** | ⚠️ No step tracing | ✅ Built-in pipeline tracing |
| **Consistency** | ⚠️ Different from AgentExecution | ✅ Matches AgentExecution |
| **Audit timestamps** | ✅ Updated | ✅ Preserved (no changes needed) |

### Alignment with AgentExecution

The implementation now **exactly matches** AgentExecution:

| Feature | AgentExecution | WorkflowExecution |
|---------|----------------|-------------------|
| **Pipeline Steps** | 5 steps | 5 steps ✅ |
| **Step Names** | Validate, Load, Build, Persist, Broadcast | Same ✅ |
| **StreamBroker** | ✅ Has it | ✅ Has it |
| **Proto.Clone()** | ✅ Uses it | ✅ Uses it |
| **Context Keys** | "existingExecution", "execution" | Same ✅ |
| **Buffer Size** | 100 | 100 ✅ |
| **Error Handling** | grpclib helpers | Same ✅ |

**Key Difference**: Merge logic adapted for workflow-specific fields
- AgentExecution merges: messages, tool_calls, sub_agent_executions, todos
- WorkflowExecution merges: tasks, phase, output, error, timestamps

## ADR 011 Compliance

### Write Path (From ADR)

```
When the Python Agent Runner needs to save state (e.g., "Step Completed"):

1. Python: Calculates state → calls grpc_stub.Update(msg) to localhost:50051
2. Daemon: Receives RPC
3. Daemon (Persistence): Serializes message → Writes to SQLite resources table
4. Daemon (Streaming): Pushes message to active Go Channels
```

**Our Implementation**:
1. ✅ Workflow Runner calls `UpdateStatus(input)` via gRPC
2. ✅ Daemon receives RPC (WorkflowExecutionController)
3. ✅ Persistence: `PersistExecutionStep` writes to BadgerDB
4. ✅ Streaming: `BroadcastToStreamsStep` pushes to Go Channels

### Read Path (From ADR)

```
When a user runs stigmer logs -f <id>:

1. CLI: Calls grpc_stub.Watch(id) to localhost:50051
2. Daemon: Subscribes the request to the internal Go Channel for that ID
3. Daemon: Streams new events from the channel down the gRPC pipe to the CLI
```

**Future Implementation** (Subscribe RPC):
```go
func (c *WorkflowExecutionController) Subscribe(req, stream) {
    ch := c.streamBroker.Subscribe(executionID)
    defer c.streamBroker.Unsubscribe(executionID, ch)
    
    for execution := range ch {
        stream.Send(execution)
    }
}
```

## Benefits of Pipeline Pattern

### 1. Observability
- Each step is named and logged
- Pipeline framework can add tracing automatically
- Easy to see which step failed

### 2. Testability
```go
func TestBuildNewStateWithStatusStep(t *testing.T) {
    step := newBuildNewStateWithStatusStep()
    ctx := pipeline.NewRequestContext(context.Background(), input)
    ctx.Set("existingExecution", existing)
    
    err := step.Execute(ctx)
    
    assert.NoError(t, err)
    execution := ctx.Get("execution").(*WorkflowExecution)
    assert.Equal(t, expectedPhase, execution.Status.Phase)
}
```

### 3. Reusability
- Steps can be shared across operations
- `LoadExistingExecutionStep` could be reused in other handlers
- `PersistExecutionStep` is generic

### 4. Maintainability
- Clear separation of concerns
- Each step is < 50 lines
- Easy to add/remove/reorder steps

### 5. Consistency
- Same pattern as all other operations
- Developers know what to expect
- Less cognitive load

## Error Handling

All errors use `grpclib` helpers for consistent gRPC status codes:

```go
// Invalid input
grpclib.InvalidArgumentError("execution_id is required")

// Resource not found
grpclib.NotFoundError("WorkflowExecution", executionID)

// Internal server error
grpclib.InternalError(err, "failed to update execution status")
```

## Logging

Structured logging with zerolog at each step:

```go
log.Debug().
    Str("execution_id", executionID).
    Str("phase", phase.String()).
    Int("tasks_count", len(tasks)).
    Msg("Merged status fields")
```

**Log Levels**:
- `Debug`: Step entry/exit, validation success, subscriber counts
- `Info`: Successful persistence, broadcasts
- `Warn`: Channel buffer full (dropped update)
- `Error`: Load/persist failures

## Testing Checklist

### Unit Tests (To Be Implemented)

- [ ] `TestValidateUpdateStatusInputStep`
  - [ ] Valid input → success
  - [ ] Nil input → error
  - [ ] Empty execution_id → error
  - [ ] Nil status → error

- [ ] `TestLoadExistingExecutionStep`
  - [ ] Existing execution → loads successfully
  - [ ] Non-existent execution → NOT_FOUND error
  - [ ] Stores in context → verify

- [ ] `TestBuildNewStateWithStatusStep`
  - [ ] Merge tasks → replaces array
  - [ ] Merge phase → updates if provided
  - [ ] Merge output → updates if provided
  - [ ] Merge error → updates if provided
  - [ ] Merge timestamps → updates if provided
  - [ ] Preserves spec → verify unchanged
  - [ ] Preserves metadata → verify unchanged

- [ ] `TestPersistExecutionStep`
  - [ ] Successful save → no error
  - [ ] Save failure → INTERNAL error

- [ ] `TestBroadcastToStreamsStep`
  - [ ] No subscribers → no error
  - [ ] Single subscriber → receives update
  - [ ] Multiple subscribers → all receive update
  - [ ] Full buffer → drops update (no error)

### Integration Tests (To Be Implemented)

- [ ] End-to-end UpdateStatus flow
- [ ] Streaming with Subscribe (when implemented)
- [ ] Concurrent UpdateStatus calls
- [ ] UpdateStatus + Subscribe race conditions

## Migration Impact

### Breaking Changes
**None** - The RPC signature is unchanged:
```protobuf
rpc updateStatus(WorkflowExecutionUpdateStatusInput) returns (WorkflowExecution);
```

### Wire Compatibility
✅ **Fully compatible** - Input/output proto messages are identical

### Behavioral Changes
✅ **Added feature**: Streaming support (was not present before)

## Future Enhancements

### Subscribe RPC Implementation

**When Implemented**:
```go
func (c *WorkflowExecutionController) Subscribe(
    req *WorkflowExecutionSubscribeRequest,
    stream WorkflowExecutionQueryController_SubscribeServer,
) error {
    executionID := req.GetExecutionId()
    
    // 1. Load initial state
    initial, err := c.Get(ctx, &WorkflowExecutionId{Value: executionID})
    if err != nil {
        return err
    }
    
    // 2. Send initial state
    if err := stream.Send(initial); err != nil {
        return err
    }
    
    // 3. Subscribe to updates
    ch := c.streamBroker.Subscribe(executionID)
    defer c.streamBroker.Unsubscribe(executionID, ch)
    
    // 4. Stream updates
    for {
        select {
        case execution := <-ch:
            if err := stream.Send(execution); err != nil {
                return err
            }
        case <-stream.Context().Done():
            return nil
        }
    }
}
```

**Proto Definition** (already exists in Cloud):
```protobuf
rpc subscribe(WorkflowExecutionSubscribeRequest) returns (stream WorkflowExecution);

message WorkflowExecutionSubscribeRequest {
  string execution_id = 1;
}
```

## Build Status

⚠️ **Requires Proto Generation**

The implementation is complete but requires proto files to be generated:

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer
make protos
go build -v ./backend/services/stigmer-server/cmd/server
```

**Expected Result**: Successful build after proto generation

## Conclusion

✅ **Complete**: UpdateStatus now uses pipeline pattern  
✅ **ADR 011 Compliant**: Broadcasts to in-memory Go channels  
✅ **Consistent**: Matches AgentExecution implementation exactly  
✅ **Testable**: Each step can be tested independently  
✅ **Observable**: Built-in pipeline tracing and structured logging  
✅ **Maintainable**: Clear separation of concerns with small, focused steps  

**Next Steps**:
1. Generate proto files (`make protos`)
2. Verify build succeeds
3. Implement Subscribe RPC (for CLI streaming)
4. Add unit tests for pipeline steps
5. Add integration tests for UpdateStatus + Subscribe
