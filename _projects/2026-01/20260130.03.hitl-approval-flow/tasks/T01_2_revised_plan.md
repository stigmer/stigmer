# T01.2: Revised Architecture Plan

**Created**: 2026-01-30
**Status**: PENDING APPROVAL
**Type**: Architecture Design

---

## Executive Summary

This document presents the revised HITL approval architecture based on:
- Your design decisions (hybrid policy location, tool-only MVP, skip returns message)
- LangGraph research (interrupt/resume mechanics, subgraph propagation)
- Current proto structure analysis

---

## Design Decisions Confirmed

| Decision | Choice | Notes |
|----------|--------|-------|
| Approval policy location | **Hybrid** | Default at McpServer, override at agent |
| Sub-agent propagation | **Automatic** | LangGraph handles via checkpoints |
| Auto-approve mode | **Simple flag** | `auto_approve_all: true` |
| Task-level approval | **Not in MVP** | Tool-level only |
| Skip semantics | **Return message** | Tool returns "skipped by user" |

---

## Proto Changes

### 1. McpServerSpec - Default Approval Policy

**File**: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`

```protobuf
message McpServerSpec {
  // ... existing fields (1-8) ...
  
  // NEW: Default tool approval policies for this MCP server.
  // Tools listed here require approval before execution by default.
  // Can be overridden per-agent in McpServerUsage.tool_approval_overrides.
  //
  // Example: Mark destructive GitHub tools as requiring approval by default:
  //   default_tool_approvals:
  //     - tool_name: "delete_repository"
  //       message: "Delete repository: {{args.repo}}"
  //     - tool_name: "force_push"
  //       message: "Force push to {{args.branch}}"
  repeated ToolApprovalPolicy default_tool_approvals = 9;
}

// ToolApprovalPolicy defines approval requirements for a specific tool.
message ToolApprovalPolicy {
  // Name of the tool (must match tools/list from MCP server).
  string tool_name = 1;
  
  // Human-readable message shown to user when approval is requested.
  // Supports {{args.field}} placeholders for tool arguments.
  // Default: "Execute tool: {tool_name}"
  string message = 2;
}
```

### 2. McpServerUsage - Per-Agent Override

**File**: `apis/ai/stigmer/agentic/agent/v1/spec.proto`

```protobuf
message McpServerUsage {
  ApiResourceReference mcp_server_ref = 1;
  repeated string enabled_tools = 2;
  
  // NEW: Override approval requirements for specific tools.
  // Takes precedence over McpServer.default_tool_approvals.
  //
  // Use cases:
  // - Disable approval for tool that has default approval
  // - Add approval for tool that doesn't have default
  // - Customize approval message for this agent
  //
  // Example: Disable approval for a trusted agent:
  //   tool_approval_overrides:
  //     - tool_name: "delete_repository"
  //       requires_approval: false
  repeated ToolApprovalOverride tool_approval_overrides = 3;
}

// ToolApprovalOverride allows per-agent customization of approval requirements.
message ToolApprovalOverride {
  // Name of the tool to override.
  string tool_name = 1;
  
  // Whether this tool requires approval for this agent.
  // false = no approval needed (even if McpServer has default)
  // true = approval needed (with optional custom message)
  bool requires_approval = 2;
  
  // Optional: Custom approval message for this agent.
  // If not set and requires_approval=true, uses McpServer's default message.
  string message = 3;
}
```

### 3. ToolCallStatus - Add WAITING_APPROVAL

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto`

```protobuf
enum ToolCallStatus {
  TOOL_CALL_STATUS_UNSPECIFIED = 0;
  TOOL_CALL_PENDING = 1;
  TOOL_CALL_RUNNING = 2;
  TOOL_CALL_COMPLETED = 3;
  TOOL_CALL_FAILED = 4;
  TOOL_CALL_WAITING_APPROVAL = 5;  // NEW: Blocked on user approval
  TOOL_CALL_SKIPPED = 6;           // NEW: User skipped this tool
}
```

### 4. ToolCall - Add Approval Fields

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`

```protobuf
message ToolCall {
  string id = 1;
  string name = 2;
  Struct args = 3;
  string result = 4;
  ToolCallStatus status = 5;
  ComponentMetadata component_metadata = 6;
  string started_at = 7;
  string completed_at = 8;
  string error = 9;
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Approval Fields (HITL)
  //
  // These fields track the approval state for tools that require user consent.
  // ─────────────────────────────────────────────────────────────────────────────
  
  // True if this tool requires approval before execution.
  // Determined by merging McpServer.default_tool_approvals with
  // McpServerUsage.tool_approval_overrides.
  bool requires_approval = 10;
  
  // Human-readable message explaining what approval is being requested.
  // Populated from ToolApprovalPolicy.message with args substituted.
  // Example: "Delete repository: my-repo"
  string approval_message = 11;
  
  // ISO 8601 timestamp when approval was requested.
  // Set when status transitions to TOOL_CALL_WAITING_APPROVAL.
  string approval_requested_at = 12;
  
  // ISO 8601 timestamp when approval decision was made.
  // Set when user submits APPROVE, SKIP, or REJECT.
  string approval_decided_at = 13;
  
  // User ID of who made the approval decision.
  // Extracted from request context when SubmitApproval is called.
  string approved_by = 14;
  
  // The action taken by the user.
  // Only populated after approval decision is made.
  ApprovalAction approval_action = 15;
}

// ApprovalAction represents the user's decision on an approval request.
enum ApprovalAction {
  APPROVAL_ACTION_UNSPECIFIED = 0;
  APPROVAL_ACTION_APPROVE = 1;  // Execute the tool
  APPROVAL_ACTION_SKIP = 2;     // Skip tool, continue execution
  APPROVAL_ACTION_REJECT = 3;   // Stop execution with error
}
```

### 5. ExecutionPhase - Add WAITING_FOR_APPROVAL

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto`

```protobuf
enum ExecutionPhase {
  EXECUTION_PHASE_UNSPECIFIED = 0;
  EXECUTION_PENDING = 1;
  EXECUTION_IN_PROGRESS = 2;
  EXECUTION_COMPLETED = 3;
  EXECUTION_FAILED = 4;
  EXECUTION_CANCELLED = 5;
  EXECUTION_WAITING_FOR_APPROVAL = 6;  // NEW: Blocked on tool approval
}
```

### 6. AgentExecutionStatus - Add Pending Approval

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/api.proto`

```protobuf
message AgentExecutionStatus {
  // ... existing fields (1-12) ...
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Pending Approval (HITL)
  //
  // When phase == EXECUTION_WAITING_FOR_APPROVAL, this field contains
  // details about the tool call awaiting user decision.
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Current pending approval request, if any.
  // Populated when a tool with requires_approval=true is about to execute.
  // Cleared when user submits approval decision.
  PendingApproval pending_approval = 13;
}

// PendingApproval surfaces the current approval request for UI display.
message PendingApproval {
  // ID of the tool call waiting for approval.
  // Use this when calling SubmitApproval.
  string tool_call_id = 1;
  
  // Name of the tool.
  string tool_name = 2;
  
  // Human-readable approval message.
  string message = 3;
  
  // Sanitized preview of tool arguments (may redact secrets).
  string args_preview = 4;
  
  // When the approval was requested.
  string requested_at = 5;
  
  // True if this approval originates from a sub-agent.
  // UI can show "Sub-agent needs approval" differently.
  bool from_sub_agent = 6;
  
  // If from sub-agent, which one.
  string sub_agent_name = 7;
}
```

### 7. AgentExecutionSpec - Add Auto-Approve Flag

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto`

```protobuf
message AgentExecutionSpec {
  // ... existing fields ...
  
  // NEW: Auto-approve all tool executions.
  // When true, tools that require approval are automatically approved.
  // Use for automation scenarios where human intervention isn't desired.
  // Default: false (approvals required as configured)
  bool auto_approve_all = 10;
}
```

### 8. SubmitApproval RPC

**File**: `apis/ai/stigmer/agentic/agentexecution/v1/command.proto`

```protobuf
service AgentExecutionCommandController {
  // ... existing RPCs ...
  
  // Submit approval decision for a pending tool call.
  // The agent execution must be in EXECUTION_WAITING_FOR_APPROVAL phase.
  // The tool_call_id must match the pending_approval.tool_call_id.
  rpc SubmitApproval(SubmitApprovalInput) returns (google.protobuf.Empty);
}

// Input for submitting an approval decision.
message SubmitApprovalInput {
  // Agent execution ID.
  string agent_execution_id = 1 [(buf.validate.field).required = true];
  
  // Tool call ID (from pending_approval.tool_call_id).
  string tool_call_id = 2 [(buf.validate.field).required = true];
  
  // User's decision: APPROVE, SKIP, or REJECT.
  ApprovalAction action = 3 [(buf.validate.field).enum.defined_only = true];
  
  // Optional: Reason for the decision (for audit log).
  string comment = 4;
}
```

### 9. WorkflowTaskStatus - Add WAITING_APPROVAL

**File**: `apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto`

```protobuf
enum WorkflowTaskStatus {
  WORKFLOW_TASK_STATUS_UNSPECIFIED = 0;
  WORKFLOW_TASK_PENDING = 1;
  WORKFLOW_TASK_IN_PROGRESS = 2;
  WORKFLOW_TASK_COMPLETED = 3;
  WORKFLOW_TASK_FAILED = 4;
  WORKFLOW_TASK_SKIPPED = 5;
  WORKFLOW_TASK_WAITING_APPROVAL = 6;  // NEW: Child agent needs approval
}
```

---

## Python Implementation: StatusBuilder Changes

### Approval Check Logic

```python
def should_require_approval(
    tool_name: str,
    mcp_server_spec: McpServerSpec,
    mcp_server_usage: McpServerUsage,
    auto_approve_all: bool
) -> tuple[bool, str]:
    """
    Determine if a tool requires approval and return the message.
    
    Returns: (requires_approval, message)
    """
    # Auto-approve mode bypasses all checks
    if auto_approve_all:
        return False, ""
    
    # Check for per-agent override first
    for override in mcp_server_usage.tool_approval_overrides:
        if override.tool_name == tool_name:
            if not override.requires_approval:
                return False, ""
            # Override requires approval
            return True, override.message or f"Execute tool: {tool_name}"
    
    # Fall back to MCP server defaults
    for policy in mcp_server_spec.default_tool_approvals:
        if policy.tool_name == tool_name:
            return True, policy.message or f"Execute tool: {tool_name}"
    
    # No approval required
    return False, ""
```

### Tool Wrapper with Interrupt

```python
from langgraph.types import interrupt, Command

def create_approval_wrapped_tool(
    original_tool: Callable,
    tool_name: str,
    requires_approval: bool,
    approval_message: str,
    status_builder: StatusBuilder
):
    """
    Wrap a tool with approval logic using LangGraph interrupt.
    """
    def wrapped_tool(*args, **kwargs):
        if requires_approval:
            # Update status to waiting
            status_builder.set_tool_waiting_approval(
                tool_name=tool_name,
                args=kwargs,
                message=approval_message
            )
            
            # Pause execution - this is where LangGraph checkpoints
            response = interrupt({
                "tool_name": tool_name,
                "args": sanitize_args(kwargs),
                "message": approval_message
            })
            
            action = response.get("action", "reject")
            comment = response.get("comment", "")
            
            # Update status with decision
            status_builder.set_tool_approval_decision(
                tool_name=tool_name,
                action=action,
                comment=comment
            )
            
            if action == "approve":
                # Execute the tool
                result = original_tool(*args, **kwargs)
                return result
                
            elif action == "skip":
                # Return message that LLM will see
                return f"Tool '{tool_name}' was skipped by user. Please proceed without this operation."
                
            elif action == "reject":
                raise ToolExecutionRejectedError(
                    f"User rejected execution of '{tool_name}': {comment}"
                )
        else:
            # No approval needed
            return original_tool(*args, **kwargs)
    
    return wrapped_tool
```

---

## Workflow-to-Agent Propagation

### How It Works

1. **Workflow starts agent task**:
   ```
   WorkflowTask {
     task_type: WORKFLOW_TASK_AGENT_INVOCATION
     status: WORKFLOW_TASK_IN_PROGRESS
     metadata: { agent_execution_id: "agx-123" }
   }
   ```

2. **Agent hits approval**:
   ```
   AgentExecution {
     phase: EXECUTION_WAITING_FOR_APPROVAL
     pending_approval: { tool_call_id: "tc-456", ... }
   }
   ```

3. **Workflow runner detects this** (via polling or callback):
   ```
   WorkflowTask {
     status: WORKFLOW_TASK_WAITING_APPROVAL
     metadata: { 
       agent_execution_id: "agx-123",
       pending_approval: { ... }  // Copied from agent
     }
   }
   WorkflowExecution {
     phase: EXECUTION_WAITING_FOR_APPROVAL
   }
   ```

4. **User submits approval to WorkflowExecution API**:
   ```
   SubmitWorkflowTaskApproval {
     workflow_execution_id: "wfx-789"
     task_id: "task-1"
     action: APPROVE
   }
   ```

5. **Workflow runner forwards to agent**:
   ```
   // Internal call
   AgentExecutionService.SubmitApproval({
     agent_execution_id: "agx-123",
     tool_call_id: "tc-456",
     action: APPROVE
   })
   ```

6. **Agent resumes** - LangGraph checkpoint restored, tool executes.

---

## Sub-Agent Propagation

LangGraph handles this automatically:

1. **Main agent calls sub-agent** (via "task" tool)
2. **Sub-agent's tool calls `interrupt()`**
3. **LangGraph checkpoints both** - Sub-agent and main agent state saved
4. **Main agent surfaces approval** - `pending_approval.from_sub_agent = true`
5. **User approves at main agent level**
6. **`Command(resume=...)` flows through** - Both graphs resume

No special code needed - just ensure `thread_id` consistency.

---

## Implementation Phases

### Phase 1: Proto Contracts (~2 days)
- [ ] Add `ToolApprovalPolicy` to `McpServerSpec`
- [ ] Add `ToolApprovalOverride` to `McpServerUsage`
- [ ] Add `ApprovalAction` enum
- [ ] Add approval fields to `ToolCall`
- [ ] Add `TOOL_CALL_WAITING_APPROVAL` and `TOOL_CALL_SKIPPED` statuses
- [ ] Add `EXECUTION_WAITING_FOR_APPROVAL` phase
- [ ] Add `PendingApproval` message
- [ ] Add `pending_approval` to `AgentExecutionStatus`
- [ ] Add `auto_approve_all` to `AgentExecutionSpec`
- [ ] Add `SubmitApproval` RPC
- [ ] Regenerate all stubs (Python, Go, Java, TypeScript, Dart)

### Phase 2: StatusBuilder Updates (~2 days)
- [ ] Add approval state tracking methods
- [ ] Add `set_tool_waiting_approval()` method
- [ ] Add `set_tool_approval_decision()` method
- [ ] Update `_handle_tool_start_event()` to check approval requirements
- [ ] Add unit tests for approval state management

### Phase 3: LangGraph Integration (~3 days)
- [ ] Create `should_require_approval()` helper
- [ ] Create `create_approval_wrapped_tool()` wrapper
- [ ] Integrate with tool initialization in `execute_graphton.py`
- [ ] Test interrupt/resume flow locally
- [ ] Handle sub-agent approval surfacing

### Phase 4: Java Handler (~2 days)
- [ ] Implement `SubmitApproval` RPC handler
- [ ] Add validation (correct phase, matching tool_call_id)
- [ ] Signal the Temporal workflow to resume agent
- [ ] Add audit logging for approval decisions

### Phase 5: Workflow Integration (~2 days)
- [ ] Detect child agent waiting for approval
- [ ] Add `WORKFLOW_TASK_WAITING_APPROVAL` status handling
- [ ] Implement approval forwarding to child agent
- [ ] Add `SubmitWorkflowTaskApproval` RPC (optional, can route through existing)

### Phase 6: CLI Support (~1 day)
- [ ] Detect `EXECUTION_WAITING_FOR_APPROVAL` in streaming output
- [ ] Display approval prompt with tool details
- [ ] Accept user input (approve/skip/reject)
- [ ] Call SubmitApproval API

### Phase 7: Integration Testing (~2 days)
- [ ] Test direct agent + tool approval (approve)
- [ ] Test direct agent + tool approval (skip)
- [ ] Test direct agent + tool approval (reject)
- [ ] Test auto_approve_all mode
- [ ] Test sub-agent approval propagation
- [ ] Test workflow-to-agent propagation

---

## Success Criteria

### MVP (Must Have)
- [ ] Tool-level approval works for direct agent calls
- [ ] Three actions work: Approve, Skip, Reject
- [ ] ToolCall shows approval state during streaming
- [ ] CLI can display approval prompt and accept input
- [ ] Auto-approve mode works

### Phase 2 (Should Have)
- [ ] Sub-agent approval propagates to main agent
- [ ] Workflow detects and surfaces child agent approval

### Future (Nice to Have)
- [ ] Task-level approval in workflows
- [ ] Granular auto-approve (per-tool list)
- [ ] Approval timeout configuration
- [ ] Bulk approvals (approve all pending)

---

## Review Questions

1. Does the hybrid approval policy location (McpServer default + agent override) look correct?
2. Is the `PendingApproval` message structure sufficient for UI needs?
3. Any concerns with the workflow-to-agent propagation approach?
4. Ready to proceed with Phase 1 (Proto Contracts)?

---

**Please review and approve this plan before I begin implementation.**
