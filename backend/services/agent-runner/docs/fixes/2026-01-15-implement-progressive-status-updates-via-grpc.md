# Separate Status Updates RPC

**Date:** 2026-01-15  
**Type:** Feature Enhancement  
**Status:** ✅ Complete

## Overview

Separated agent execution status updates (from agent-runner) from user-initiated spec updates by creating a dedicated `updateStatus` RPC. This provides cleaner separation of concerns and more appropriate handling for each update type.

## Problem

Previously, both user updates (spec changes) and agent-runner status updates (progressive execution status) used the same `update` RPC. This mixing of concerns led to:

- Custom pipeline step in the update handler specifically for status updates
- Confusion about update behavior (status merge vs spec update)
- No clear separation between user operations and system operations

## Solution

Created two separate RPCs:

1. **`update`** - For user-initiated spec updates (standard pipeline)
2. **`updateStatus`** - For agent-runner status updates (custom status-merge pipeline)

## Changes

### 1. Proto Definition

Added new `updateStatus` RPC to `command.proto`:

```protobuf
// Update execution status during agent execution.
// Used by agent-runner to send progressive status updates (messages, tool_calls, phase, etc.)
// This RPC is optimized for frequent status updates and merges status fields with existing state.
rpc updateStatus(AgentExecution) returns (AgentExecution) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = agent_execution;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_edit;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "metadata.id";
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to update agent execution status";
}
```

### 2. New Handler: AgentExecutionUpdateStatusHandler

Created dedicated handler for status updates with custom pipeline:

**Pipeline:**
1. ValidateFieldConstraints - Validate protobuf constraints
2. ResolveSlug - Resolve slug (for fallback slug lookup)
3. LoadExisting - Load existing execution from repository
4. Authorize - Check can_edit permission
5. **BuildNewStateWithStatus** - Custom step that merges status, preserves spec
6. Persist - Save to MongoDB
7. Publish - Publish event
8. PublishToRedis - Publish to Redis for real-time updates
9. TransformResponse - Apply transformations
10. SendResponse - Send gRPC response

**Key Feature:** The `BuildNewStateWithStatusStep` merges status fields from the request with existing execution state WITHOUT updating the spec.

### 3. Updated Handler: AgentExecutionUpdateHandler

Simplified to standard update pipeline for user spec updates:

**Pipeline:**
1. ValidateFieldConstraints - Validate protobuf constraints
2. ResolveSlug - Resolve slug (for fallback slug lookup)
3. LoadExisting - Load existing execution from repository
4. Authorize - Check can_edit permission
5. **BuildNewState** - Standard build (updates spec, clears status per standard pattern)
6. Persist - Save to MongoDB
7. Publish - Publish event
8. TransformResponse - Apply transformations
9. SendResponse - Send gRPC response

**Key Feature:** Uses standard `buildNewState` which updates spec and clears status (standard API resource pattern).

### 4. Agent Runner Client Update

Updated `AgentExecutionClient` to use the new RPC:

**Before:**
```python
await execution_client.update(
    execution_id=execution_id,
    status=status_builder.current_status
)
```

**After:**
```python
await execution_client.update_status(
    execution_id=execution_id,
    status=status_builder.current_status
)
```

### 5. Activity Updates

Updated `execute_graphton.py` to use `update_status`:
- Progressive status updates during execution
- Final status update after completion

## Benefits

### Clean Separation of Concerns

- **User Updates:** Clear intent for spec changes
- **System Updates:** Clear intent for status progression
- **No Mixing:** Each RPC has its own purpose and behavior

### Appropriate Pipeline Steps

- **User updates:** Standard pipeline with spec merge and status clear
- **Status updates:** Custom pipeline with status merge and spec preservation

### Better Code Organization

- Each handler is focused on a single responsibility
- Custom logic isolated to the handler that needs it
- Standard handler remains simple and predictable

### Improved Maintainability

- Easier to understand what each RPC does
- Easier to modify behavior for each update type
- Less conditional logic in handlers

## Testing

After proto regeneration, verify:

1. **Agent-runner status updates work:**
   ```bash
   # Create an execution
   # Monitor status updates in real-time
   # Verify progressive updates (messages, tool_calls, phase)
   ```

2. **User spec updates work:**
   ```bash
   # Create an execution
   # Update spec fields via API
   # Verify spec changes applied
   ```

3. **Status is preserved correctly:**
   - User updates should clear status (standard pattern)
   - Status updates should merge status fields
   - Spec should not change during status updates

## Files Modified

```
apis/ai/stigmer/agentic/agentexecution/v1/command.proto
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/
  - AgentExecutionUpdateHandler.java (simplified)
  - AgentExecutionUpdateStatusHandler.java (new)
backend/services/agent-runner/
  - grpc_client/agent_execution_client.py
  - worker/activities/execute_graphton.py
```

## Next Steps

1. **Regenerate proto:** Run proto codegen to generate `updateStatus` method
2. **Build services:** Rebuild stigmer-service and agent-runner
3. **Test integration:** Verify status updates flow correctly
4. **Deploy:** Deploy updated services to environment

## Architecture Notes

This separation aligns with our principle of **clear operation boundaries**:

- User operations modify spec (configuration)
- System operations modify status (runtime state)
- Each operation has appropriate validation and authorization
- No mixing of concerns at the RPC level

The auto-generated controller (`AgentExecutionGrpcAutoController`) will automatically route requests to the appropriate handler based on the method name.
