# T01.1: Research Findings

**Date**: 2026-01-30
**Status**: Complete

## LangGraph Interrupt/Resume Mechanics

### Key Discoveries

1. **`interrupt()` function** - Works like Python's `input()` but in production:
   ```python
   response = interrupt("Approve this action?")
   # Execution pauses here, state saved
   # When resumed, response contains the value from Command(resume=...)
   ```

2. **Resume with `Command(resume=value)`**:
   - The resume value becomes the return value of `interrupt()`
   - Any JSON-serializable value can be passed
   - Example: `graph.invoke(Command(resume={"action": "approve"}), config=config)`

3. **Checkpoint persistence**:
   - Requires a checkpointer (SqliteSaver, PostgresSaver, etc.)
   - Requires a `thread_id` in config to identify the checkpoint
   - State is saved at the exact point of interrupt

4. **Node re-execution on resume**:
   - When resumed, the **entire node restarts from the beginning**
   - Code before `interrupt()` runs again
   - Side effects must be idempotent

5. **Interrupts in tools** - Can be placed directly inside tool functions:
   ```python
   @tool
   def send_email(to: str, subject: str, body: str):
       response = interrupt({
           "action": "send_email",
           "to": to,
           "message": "Approve sending this email?"
       })
       if response.get("action") == "approve":
           # Execute the email
           return "Email sent"
       return "Email cancelled by user"
   ```

6. **Subgraph interrupts propagate** - When a subgraph calls `interrupt()`:
   - Both parent node and subgraph node re-execute on resume
   - This means sub-agent approval naturally bubbles up

### Implications for Our Architecture

1. **LangGraph natively supports tool-level interrupts** - Perfect for our use case
2. **No separate "skip" action in LangGraph** - We implement it via resume value handling
3. **Sub-agent propagation is built-in** - Checkpoint system handles nested graphs
4. **Thread ID = our agent_execution_id** - Natural correlation

---

## Current Proto Structure Analysis

### McpServer (where default approval should live)

```protobuf
// mcpserver/v1/spec.proto
message McpServerSpec {
  string description = 1;
  string icon_url = 2;
  repeated string tags = 3;
  oneof server_type { StdioServerConfig stdio = 4; HttpServerConfig http = 5; }
  repeated string default_enabled_tools = 7;  // <-- No approval here yet
  EnvironmentSpec env_spec = 8;
}
```

**Recommendation**: Add `ToolApprovalPolicy` here for system-wide defaults.

### McpServerUsage (where agent can override)

```protobuf
// agent/v1/spec.proto
message McpServerUsage {
  ApiResourceReference mcp_server_ref = 1;
  repeated string enabled_tools = 2;  // <-- No approval override here yet
}
```

**Recommendation**: Add optional `tool_approval_overrides` for per-agent customization.

### ToolCall (where approval state should live)

```protobuf
// agentexecution/v1/api.proto
message ToolCall {
  string id = 1;
  string name = 2;
  Struct args = 3;
  string result = 4;
  ToolCallStatus status = 5;  // PENDING, RUNNING, COMPLETED, FAILED
  ComponentMetadata component_metadata = 6;
  string started_at = 7;
  string completed_at = 8;
  string error = 9;
  // <-- No approval fields yet
}
```

**Recommendation**: Add approval fields here (not as separate ApprovalRequirement).

### WorkflowTask (for nested approval propagation)

```protobuf
// workflowexecution/v1/api.proto
message WorkflowTask {
  string task_id = 1;
  string task_name = 2;
  WorkflowTaskType task_type = 3;  // AGENT_INVOCATION is relevant
  Struct input = 4;
  Struct output = 5;
  WorkflowTaskStatus status = 6;  // No WAITING_APPROVAL yet
  // ...
}
```

When `task_type = WORKFLOW_TASK_AGENT_INVOCATION`, the task's metadata contains `agent_execution_id`. The workflow runner can poll/watch this agent execution to detect when it's waiting for approval.

---

## Workflow-to-Agent Approval Propagation

### Your Question Answered

> "When agent execution is stopped for approval within a workflow, how does that propagate to workflow state?"

**Answer**: The `WorkflowTask` that invokes the agent would:

1. **Detect agent is waiting** - Poll `AgentExecution.status.phase == WAITING_FOR_APPROVAL`
2. **Transition task to waiting** - `WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL` (new status)
3. **Expose pending approval info** - `WorkflowTask.metadata.pending_approval = {...}`
4. **Workflow phase also changes** - `ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL`

When user submits approval:
1. **Approval goes to WorkflowExecution API** (since that's what user invoked)
2. **Workflow runner forwards to AgentExecution** (via signal or direct API call)
3. **Agent resumes** - LangGraph checkpoint restored
4. **Task completes** - Workflow continues

---

## Skip Action Implementation

Based on research, here's how "skip" works:

```python
@tool
def dangerous_tool(args: str):
    response = interrupt({
        "tool": "dangerous_tool",
        "args": args,
        "message": "Execute this dangerous operation?"
    })
    
    action = response.get("action")
    
    if action == "approve":
        # Execute the tool
        return execute_dangerous_operation(args)
    elif action == "skip":
        # Return message that LLM will see
        return "Tool execution skipped by user. Please proceed without this operation."
    elif action == "reject":
        # Fail the execution
        raise ToolExecutionRejectedError("User rejected tool execution")
```

The LLM receives the "skipped by user" message and can adapt its behavior accordingly.

---

## Alignment with Cursor's Approach

Based on research, Cursor's approach:
- **Approve/Reject/Skip** - Three actions visible to user
- **Skip continues execution** - Doesn't fail the agent
- **Reject stops execution** - Agent fails with error

Our approach aligns with this:
- `ApprovalAction.APPROVE` - Execute tool
- `ApprovalAction.SKIP` - Tool returns "skipped" message, agent continues
- `ApprovalAction.REJECT` - Agent fails with rejection error

---

## Sub-Agent Propagation Depth

From LangGraph docs on "Using with subgraphs called as functions":

> "When invoking a subgraph within a node, the parent graph will resume execution from the beginning of the node where the subgraph was invoked"

This means:
1. **Main agent calls sub-agent** (via "task" tool)
2. **Sub-agent's tool calls `interrupt()`**
3. **Interrupt propagates up** - Both sub-agent and main agent checkpointed
4. **User approves at main agent level**
5. **Command(resume=...) flows down** - Both graphs resume

**Conclusion**: Sub-agent propagation happens automatically through LangGraph's checkpoint system. We don't need special handling - just ensure the `thread_id` is consistent.

---

## Summary of Decisions Confirmed

| Question | Decision | Rationale |
|----------|----------|-----------|
| Q1: Approval policy location | **Hybrid** | Default at McpServer, override at agent |
| Q2: Sub-agent propagation | **Automatic via LangGraph** | Checkpoint system handles it |
| Q3: Auto-approve mode | **Keep simple flag** | `auto_approve_all: true` in execution spec |
| Q4: Task-level approval | **Tool-only for MVP** | Simpler, task approval adds complexity |
| Q5: Skip semantics | **Tool returns "skipped by user"** | LLM can adapt behavior |

---

## Next Steps

1. **Update T01_0_plan.md** with revised architecture
2. **Create proto design** based on findings
3. **Get user approval** on revised plan
4. **Begin implementation**
