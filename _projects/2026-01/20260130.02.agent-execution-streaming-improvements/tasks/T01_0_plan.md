# Task T01: Agent Execution Streaming Improvements - Master Plan

**Created**: 2026-01-30
**Status**: PENDING REVIEW

## Executive Summary

This project addresses critical gaps identified in the AgentExecution proto contract and LangGraph streaming implementation. The improvements are organized into three phases:

1. **Phase 1 - Critical Fixes** (Data Loss/Incorrect Behavior)
2. **Phase 2 - Should Fix** (Incomplete Design)  
3. **Phase 3 - Future Foundation** (Extensibility)

---

## Phase 1: Critical Fixes (Must Fix)

These issues cause data loss or incorrect behavior and should be addressed first.

### 1.1 Handle `on_chat_model_end` Event

**Problem**: StatusBuilder only handles 3 event types (`on_tool_start`, `on_tool_end`, `on_chat_model_stream`). Missing `on_chat_model_end` means:
- No token counts captured (only available in this event)
- Messages never "finalize" - keep appending forever
- No usage statistics for billing/debugging

**Files to modify**:
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

**Implementation**:
```python
def _handle_chat_model_end_event(self, event: Dict[str, Any], namespace: str = "") -> None:
    """Handle chat model completion - finalize message and capture usage."""
    chunk_data = event.get("data", {}).get("output", {})
    
    # Mark last AI message as complete
    for message in reversed(self.current_status.messages):
        if message.type == MessageType.MESSAGE_AI:
            message.is_streaming = False
            break
    
    # Extract usage if available (from LangChain response)
    if hasattr(chunk_data, "usage_metadata"):
        # Accumulate in status.usage
```

**Acceptance Criteria**:
- [ ] `on_chat_model_end` handler implemented
- [ ] AI messages marked as finalized when complete
- [ ] Token counts extracted and accumulated

---

### 1.2 Time-Based Streaming Updates

**Problem**: Current event-count based updates (`update_interval = 10`) cause poor UX:
- Slow operations: 30s tool = no update for 30s (user thinks stuck)
- Fast operations: 100 events/sec = 10 updates/sec (wasteful)

**Files to modify**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py`

**Implementation**:
```python
UPDATE_MIN_INTERVAL_MS = 500  # At least every 500ms
UPDATE_MIN_EVENTS = 5  # At least every 5 events

last_update_time = time.time()
last_update_events = 0

async for event in agent_graph.astream_events(...):
    await status_builder.process_event(event)
    events_processed += 1
    
    now = time.time()
    events_since_update = events_processed - last_update_events
    time_since_update = (now - last_update_time) * 1000
    
    # Update if enough time OR enough events
    if time_since_update >= UPDATE_MIN_INTERVAL_MS or events_since_update >= UPDATE_MIN_EVENTS:
        await send_update()
        last_update_time = now
        last_update_events = events_processed
```

**Acceptance Criteria**:
- [ ] Time-based update logic implemented
- [ ] Configurable intervals (env vars or config)
- [ ] Tested with both slow and fast operations

---

### 1.3 Reliable Final Status Persistence

**Problem**: If final status update fails, data is lost. The workflow return doesn't persist - it's only for observability.

**Files to modify**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py`
- Potentially: Java workflow to add backup persistence

**Implementation Options**:
1. **Retry final update** with exponential backoff
2. **Workflow backup**: Have Java workflow persist on completion if Python didn't

**Acceptance Criteria**:
- [ ] Final status update has retry logic (3 attempts, exponential backoff)
- [ ] Failure logged with full context for debugging
- [ ] Consider: Workflow-level backup persistence

---

## Phase 2: Should Fix (Incomplete Design)

These issues represent incomplete design that will cause problems as the system scales.

### 2.1 Add Streaming State to AgentMessage

**Problem**: Frontend cannot differentiate partial vs complete messages.

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

**Proto Changes**:
```protobuf
message AgentMessage {
  // ... existing fields ...
  
  // Indicates if this message is still receiving content (streaming)
  bool is_streaming = 6;
  
  // Token count for this message (populated when complete)
  int32 token_count = 7;
  
  // Duration in milliseconds to generate this message
  int32 generation_duration_ms = 8;
}
```

**Acceptance Criteria**:
- [ ] Proto updated with new fields
- [ ] StatusBuilder sets `is_streaming = true` on message creation
- [ ] StatusBuilder sets `is_streaming = false` on `on_chat_model_end`
- [ ] Token count populated when available
- [ ] Stubs regenerated for all languages

---

### 2.2 Use RUNNING Status for ToolCall

**Problem**: Tools jump from PENDING → COMPLETED, skipping RUNNING. Long-running tools have no visibility.

**Files to modify**:
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

**Implementation**:
```python
def _handle_tool_start_event(self, event, namespace):
    # ... existing code ...
    tool_call = ToolCall(
        id=run_id,
        name=tool_name,
        status=ToolCallStatus.TOOL_CALL_RUNNING,  # Changed from PENDING
        started_at=datetime.utcnow().isoformat(),
        # ...
    )
```

**Acceptance Criteria**:
- [ ] Tools start in RUNNING state (or transition immediately from PENDING)
- [ ] Frontend can show "running" indicator for long tools

---

### 2.3 Capture Sub-Agent Internals

**Problem**: `SubAgentExecution` only captures input/output, not what happened inside. If sub-agent fails on 8th tool call, no visibility into what happened.

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

**Proto Changes** (Option A - Nested fields):
```protobuf
message SubAgentExecution {
  // ... existing fields ...
  
  // Nested execution state - captures what happened inside the sub-agent
  repeated ToolCall tool_calls = 10;
  repeated AgentMessage messages = 11;
}
```

**Proto Changes** (Option B - Full nested status):
```protobuf
message SubAgentExecution {
  // ... existing fields ...
  
  // Full nested execution status (recursive)
  AgentExecutionStatus nested_status = 10;
}
```

**StatusBuilder Changes**:
- Route events by `langgraph_checkpoint_ns` to correct sub-agent
- Use `namespace_mapping` (already exists but unused)

**Acceptance Criteria**:
- [ ] Sub-agent tool calls captured separately from main agent
- [ ] Sub-agent messages captured
- [ ] Namespace-based routing implemented

---

### 2.4 Add UsageMetrics for Token/Cost Tracking

**Problem**: No way to track tokens consumed, API costs, or rate limits.

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

**Proto Changes**:
```protobuf
message UsageMetrics {
  // Input tokens (prompt)
  int32 prompt_tokens = 1;
  
  // Output tokens (completion)
  int32 completion_tokens = 2;
  
  // Total tokens
  int32 total_tokens = 3;
  
  // Actual model used (may differ from requested)
  string model_used = 4;
  
  // Estimated cost in USD (optional)
  double estimated_cost_usd = 5;
}

message AgentExecutionStatus {
  // ... existing fields ...
  
  // Token and cost tracking
  UsageMetrics usage = 11;
}
```

**Acceptance Criteria**:
- [ ] UsageMetrics message defined
- [ ] StatusBuilder accumulates tokens from `on_chat_model_end`
- [ ] Model name captured

---

### 2.5 Add Resolved Execution Context Visibility

**Problem**: Can't see what the agent actually had access to (env vars, MCP servers, skills).

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
- `backend/services/agent-runner/worker/activities/execute_graphton.py`

**Proto Changes**:
```protobuf
message ResolvedExecutionContext {
  // Environment variable keys available (not values for security)
  repeated string environment_keys = 1;
  
  // MCP servers and their connection status
  map<string, bool> mcp_server_status = 2;
  
  // Skills injected
  repeated string skill_names = 3;
}

message AgentExecutionStatus {
  // ... existing fields ...
  
  // What the agent actually had access to
  ResolvedExecutionContext resolved_context = 12;
}
```

**Acceptance Criteria**:
- [ ] ResolvedExecutionContext populated after initialization
- [ ] MCP server connection status tracked
- [ ] Skill names captured

---

## Phase 3: Future Foundation (Extensibility)

These items prepare for future features. Add the proto fields now but implementation can be deferred.

### 3.1 HITL (Human-in-the-Loop) Tool Approval Foundation

**Problem**: No fields for tool approval workflow. Need foundation before implementing HITL.

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`
- `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto`

**Proto Changes**:
```protobuf
// In enum.proto
enum ApprovalStatus {
  APPROVAL_STATUS_UNSPECIFIED = 0;
  APPROVAL_NOT_REQUIRED = 1;
  APPROVAL_PENDING = 2;
  APPROVAL_APPROVED = 3;
  APPROVAL_REJECTED = 4;
  APPROVAL_TIMED_OUT = 5;
}

// In api.proto - ToolCall message
message ToolCall {
  // ... existing fields ...
  
  // HITL approval fields
  bool requires_approval = 10;
  ApprovalStatus approval_status = 11;
  string approved_by = 12;
  string approval_timestamp = 13;
  string rejection_reason = 14;
}
```

**Acceptance Criteria**:
- [ ] ApprovalStatus enum added
- [ ] ToolCall has approval fields
- [ ] Fields optional (backward compatible)
- [ ] No implementation yet - just proto foundation

---

### 3.2 Execution Limits Foundation

**Problem**: Nothing prevents runaway agents (infinite time, tokens, tool calls).

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto`

**Proto Changes**:
```protobuf
message ExecutionConfig {
  string model_name = 1;
  
  // Execution limits
  int32 max_duration_seconds = 2;  // Max wall-clock time (0 = no limit)
  int32 max_tool_calls = 3;        // Max tool invocations (0 = no limit)
  int32 max_tokens = 4;            // Max total tokens (0 = no limit)
}
```

**Acceptance Criteria**:
- [ ] Limit fields added to ExecutionConfig
- [ ] Default to 0 (no limit) for backward compatibility
- [ ] Implementation deferred to future task

---

### 3.3 Cancellation Foundation

**Problem**: Users can't cancel a running execution.

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/command.proto`
- `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto`

**Proto Changes**:
```protobuf
// In command.proto - Add cancel RPC
service AgentExecutionCommandController {
  // ... existing RPCs ...
  
  // Cancel a running execution
  rpc cancel(AgentExecutionCancelInput) returns (AgentExecution);
}

message AgentExecutionCancelInput {
  string execution_id = 1;
  string reason = 2;  // Optional cancellation reason
}
```

**Acceptance Criteria**:
- [ ] Cancel RPC defined
- [ ] EXECUTION_CANCELLED phase already exists (verify)
- [ ] Implementation deferred to future task

---

### 3.4 Delta Updates Foundation (Optional)

**Problem**: Every update sends full state - wasteful for long conversations.

**Files to modify**:
- `apis/ai/stigmer/agentic/agentexecution/v1/command.proto`

**Proto Changes**:
```protobuf
message AgentExecutionStatusDelta {
  string execution_id = 1;
  
  // Only new messages since last update
  repeated AgentMessage new_messages = 2;
  
  // Only tool calls that changed
  repeated ToolCall updated_tool_calls = 3;
  
  // Current phase
  ExecutionPhase phase = 4;
  
  // Sequence number for ordering
  int64 sequence = 5;
}

service AgentExecutionCommandController {
  // ... existing RPCs ...
  
  // Delta update for efficiency (optional, can fall back to full update)
  rpc updateStatusDelta(AgentExecutionStatusDelta) returns (AgentExecution);
}
```

**Acceptance Criteria**:
- [ ] Delta update message defined
- [ ] Optional RPC added
- [ ] Implementation deferred (can use existing full updates)

---

## Implementation Order

### Recommended Sequence

1. **Week 1 - Critical Fixes**:
   - 1.1 Handle `on_chat_model_end` event
   - 1.2 Time-based streaming updates
   - 1.3 Reliable final status persistence

2. **Week 2 - Proto Changes + Should Fix**:
   - 2.1 Add streaming state to AgentMessage
   - 2.2 Use RUNNING status for ToolCall
   - 2.4 Add UsageMetrics
   - Regenerate all stubs

3. **Week 2-3 - Complex Should Fix**:
   - 2.3 Capture sub-agent internals (namespace routing)
   - 2.5 Add resolved execution context

4. **Week 3 - Future Foundation**:
   - 3.1 HITL fields (proto only)
   - 3.2 Execution limits fields (proto only)
   - 3.3 Cancellation RPC definition (proto only)
   - 3.4 Delta updates (optional)

---

## Testing Strategy

### Unit Tests
- StatusBuilder event handling for all event types
- Time-based update logic
- Retry logic for final persistence

### Integration Tests
- End-to-end streaming with new fields populated
- Sub-agent execution with nested tool calls
- Long-running tool with RUNNING state visible

### Manual Testing
- Frontend subscription shows streaming indicators
- Token counts visible in execution details
- Sub-agent internals visible in UI

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Proto changes break existing clients | All new fields are optional with defaults |
| Stub regeneration across 4 languages | Automated via `make build-protos` |
| Frontend not updated for new fields | Fields degrade gracefully (ignored if not used) |
| Performance impact of token tracking | Only captured on `on_chat_model_end`, not per-token |
| Sub-agent routing complexity | Start with flat routing, iterate on namespaces |

---

## Files Changed Summary

### Proto Files (apis/ai/stigmer/agentic/agentexecution/v1/)
- `api.proto` - AgentMessage, ToolCall, SubAgentExecution, AgentExecutionStatus
- `spec.proto` - ExecutionConfig
- `enum.proto` - ApprovalStatus
- `command.proto` - Cancel RPC, Delta update

### Python Files (backend/services/agent-runner/)
- `worker/activities/graphton/status_builder.py` - Event handling
- `worker/activities/execute_graphton.py` - Time-based updates, retry logic

### Java Files (stigmer-cloud/backend/)
- Handler updates may be needed for new fields

---

## Success Metrics

- [ ] All critical fixes deployed (Phase 1)
- [ ] Proto changes merged with all stubs regenerated (Phase 2)
- [ ] Sub-agent visibility working (Phase 2)
- [ ] Future foundation fields in place (Phase 3)
- [ ] No breaking changes to existing clients
- [ ] Frontend can optionally use new fields

---

## Next Steps After Approval

1. Create detailed implementation plan for Phase 1 items
2. Set up feature branch
3. Begin with `on_chat_model_end` handler (highest impact, lowest risk)
4. Create checkpoint after each phase

---

**AWAITING REVIEW**: Please review this plan and provide feedback. I will capture your review in `T01_1_review.md` and create a revised plan if needed.
