# Task T01: Architectural Design Discussion

**Created**: 2026-01-30
**Status**: PENDING REVIEW
**Type**: Architecture Design

**This is NOT an implementation plan. This is an architectural discussion document.**

Before writing any code, we need to align on fundamental design decisions. I'm presenting my analysis, alternatives, and recommendations for your review and feedback.

---

## Executive Summary

HITL (Human-in-the-Loop) approval is more complex than the previous project suggested because:

1. **Sub-agents exist now** - Phase 2.3 added sub-agent tracking, creating another nesting layer
2. **ToolCall proto already exists** - We should integrate approval into it, not create parallel structures
3. **Three execution contexts** - Direct agent, workflow→agent, agent→sub-agent
4. **LangGraph mechanics are unknown** - Must research before committing to architecture

---

## Part 1: Critical Analysis of Previous Design

### What I Learned from the Old stigmer-cloud Project

The previous HITL project (`20260118.01.hitl-approval-multi-layer`) made several assumptions I want to challenge:

### Issue 1: Approval Policy Location

**Old Design**: Approval policies in `McpToolSelection` within agent spec
```protobuf
message McpToolSelection {
  repeated ToolSelection tools = 1;
}
message ToolSelection {
  string tool_name = 1;
  bool enabled = 2;
  ToolApprovalPolicy approval_policy = 3;  // Per-agent, per-tool
}
```

**My Concern**: This means:
- Same tool (`delete_repo`) needs approval policy defined in EVERY agent that uses it
- Inconsistent enforcement (Agent A requires approval, Agent B doesn't)
- Configuration duplication

**Alternative Options**:

| Option | Location | Pros | Cons |
|--------|----------|------|------|
| A | Agent spec (per-agent, per-tool) | Flexible per-agent | Duplication, inconsistency |
| B | MCP server definition (system-wide) | Single source of truth | Less flexibility |
| C | Organization/workspace level | Admin control | Additional layer |
| D | Hybrid: Default at MCP + override at agent | Best of both | More complex |

**My Recommendation**: **Option D** - Define default approval at MCP tool level, allow agent spec to override. This provides:
- Central "these tools are dangerous" definition
- Agent-specific customization when needed
- No duplication for common cases

### Issue 2: Sub-Agents Are Missing

**Old Design**: Only considered two nesting levels:
- Direct: User → Agent → Tool
- Workflow: User → Workflow → Agent → Tool

**Current Reality** (After Phase 2.3): We have three levels:
- Direct: User → Agent → Tool
- Workflow: User → Workflow → Agent → Tool  
- Sub-agent: User → Agent → Sub-Agent → Tool
- Extreme: User → Workflow → Agent → Sub-Agent → Tool

**Question for You**: How deep should approval propagation go? Options:

| Option | Behavior | Complexity |
|--------|----------|------------|
| A | Only top-level agent/workflow handles approval | Simple but limited |
| B | Full propagation through all levels | Complex but complete |
| C | Configurable depth limit (e.g., max 2 levels) | Middle ground |

### Issue 3: Separate ApprovalRequirement vs. ToolCall Integration

**Old Design**: Created new `ApprovalRequirement` message:
```protobuf
message ApprovalRequirement {
  string approval_id = 1;
  ApprovalType approval_type = 2;
  string message = 3;
  ApprovalContext context = 4;
  google.protobuf.Timestamp requested_at = 5;
}
```

**Current State**: We already have `ToolCall` in `api.proto`:
```protobuf
message ToolCall {
  string call_id = 1;
  string tool_name = 2;
  string arguments = 3;
  google.protobuf.Timestamp started_at = 4;
  google.protobuf.Timestamp completed_at = 5;
  ToolCallStatus status = 6;  // PENDING, RUNNING, COMPLETED, FAILED
  string result = 7;
  string error = 8;
}
```

**My Strong Recommendation**: Integrate approval INTO ToolCall, not beside it:
```protobuf
message ToolCall {
  // ... existing fields ...
  
  // NEW: Approval fields (integrated)
  bool requires_approval = 9;
  ApprovalStatus approval_status = 10;  // UNSET, PENDING, APPROVED, SKIPPED, REJECTED
  string approval_message = 11;         // Why this needs approval
  google.protobuf.Timestamp approval_requested_at = 12;
  google.protobuf.Timestamp approval_decided_at = 13;
  string approved_by = 14;              // User ID who approved
}
```

**Benefits**:
- Single source of truth for tool call state
- No need to correlate `approval_id` with `tool_call_id`
- Cleaner streaming updates (ToolCall already streamed)
- Follows existing pattern (Phase 2.2 added RUNNING status to ToolCall)

### Issue 4: Double Approval is Unnecessary

**Old Design**: Task approval + Tool approval (marked "experimental")

**My Recommendation**: **Remove it entirely.** If no real use case exists, don't build it. We can always add it later if users request it.

### Issue 5: "Skip" Action Semantics

**Old Design**: Three actions - Approve, Skip, Reject

**Unanswered Questions**:
1. What happens to LLM state when user skips?
2. Does the LLM get notified "your tool was skipped"?
3. Does the LLM retry with different approach?
4. Or does execution continue as if tool returned `null`?

This is critical for LangGraph implementation and needs research.

---

## Part 2: Proposed Architecture

### Execution Context Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Interface                               │
│  (CLI, Web UI, API Client)                                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ AgentExecution  │ │WorkflowExecution│ │  Future APIs    │
│ (Direct Agent)  │ │(Orchestrated)   │ │                 │
└────────┬────────┘ └────────┬────────┘ └─────────────────┘
         │                   │
         │                   │ spawns
         │                   ▼
         │          ┌─────────────────┐
         │          │ AgentExecution  │
         │          │ (Child of WF)   │
         │          └────────┬────────┘
         │                   │
         ├───────────────────┤
         │                   │
         ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     LangGraph Agent Execution                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  Tool Call   │───▶│  Sub-Agent   │───▶│  Tool Call   │          │
│  │(main agent)  │    │  Execution   │    │(sub-agent)   │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│                                                                      │
│  Any tool call at any level can require approval                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Principle: Approval Surfaces at Execution Context Boundary

When a tool requires approval:
1. Execution pauses at that level
2. Parent execution context (if any) is notified
3. Approval request "bubbles up" to the API the user is interacting with
4. User submits approval to the API they invoked
5. Approval "flows down" to the waiting tool

### Proto Changes

#### 1. ToolCall Approval Fields (api.proto)

```protobuf
enum ApprovalStatus {
  APPROVAL_STATUS_UNSPECIFIED = 0;
  APPROVAL_STATUS_NOT_REQUIRED = 1;  // Tool doesn't need approval
  APPROVAL_STATUS_PENDING = 2;       // Waiting for user decision
  APPROVAL_STATUS_APPROVED = 3;      // User approved, execution continues
  APPROVAL_STATUS_SKIPPED = 4;       // User skipped, execution continues without tool
  APPROVAL_STATUS_REJECTED = 5;      // User rejected, execution fails
}

message ToolCall {
  // ... existing fields (1-8) ...
  
  // Approval fields
  bool requires_approval = 9;
  ApprovalStatus approval_status = 10;
  string approval_message = 11;
  google.protobuf.Timestamp approval_requested_at = 12;
  google.protobuf.Timestamp approval_decided_at = 13;
  string approved_by = 14;
}
```

#### 2. ToolCallStatus Enum Update (enum.proto)

```protobuf
enum ToolCallStatus {
  TOOL_CALL_UNSPECIFIED = 0;
  TOOL_CALL_PENDING = 1;
  TOOL_CALL_RUNNING = 2;
  TOOL_CALL_COMPLETED = 3;
  TOOL_CALL_FAILED = 4;
  TOOL_CALL_WAITING_APPROVAL = 5;  // NEW: Blocked on approval
  TOOL_CALL_SKIPPED = 6;           // NEW: Skipped by user
}
```

#### 3. ExecutionPhase Update (enum.proto)

```protobuf
enum ExecutionPhase {
  // ... existing ...
  EXECUTION_WAITING_FOR_APPROVAL = 6;  // Execution blocked on approval
}
```

#### 4. AgentExecutionStatus (api.proto)

```protobuf
message AgentExecutionStatus {
  // ... existing fields ...
  
  // Approval fields
  PendingApproval pending_approval = 13;  // Current approval request, if any
}

message PendingApproval {
  string tool_call_id = 1;     // Which tool call needs approval
  string tool_name = 2;        // Tool name for display
  string message = 3;          // Why this needs approval
  string arguments_preview = 4; // Sanitized args preview
  google.protobuf.Timestamp requested_at = 5;
  
  // For nested approvals (propagated from sub-agent)
  bool is_nested = 6;
  string child_execution_id = 7;
}
```

#### 5. SubmitApproval RPC (command.proto)

```protobuf
enum ApprovalAction {
  APPROVAL_ACTION_UNSPECIFIED = 0;
  APPROVAL_ACTION_APPROVE = 1;
  APPROVAL_ACTION_SKIP = 2;
  APPROVAL_ACTION_REJECT = 3;
}

message SubmitApprovalInput {
  string agent_execution_id = 1;
  string tool_call_id = 2;
  ApprovalAction action = 3;
  string comment = 4;  // Optional: reason for decision
}

service AgentExecutionCommandController {
  // ... existing RPCs ...
  rpc SubmitApproval(SubmitApprovalInput) returns (google.protobuf.Empty);
}
```

---

## Part 3: Open Questions Requiring Decision

### Q1: Where Should Tool Approval Policy Be Defined?

**Options**:

| Option | Description | My Preference |
|--------|-------------|---------------|
| A | Per-agent, per-tool in McpToolSelection | ❌ Duplication |
| B | At MCP server/tool definition (system-wide) | ⚠️ No flexibility |
| C | Hybrid: Default at MCP + override at agent | ✅ Recommended |

**Please confirm your preference.**

### Q2: How Deep Should Approval Propagation Go?

If Agent A calls Sub-Agent B which calls Tool T that needs approval, who handles it?

**Options**:

| Option | Behavior | Complexity |
|--------|----------|------------|
| A | Only main agent surfaces approval | Simple, sub-agents auto-approve |
| B | Full propagation (approval bubbles to top) | Complex but complete |
| C | Configurable per-sub-agent | Middle ground |

**Please confirm your preference.**

### Q3: Auto-Approve Mode?

The old design had `auto_approve_all: true` to bypass all approvals.

**Options**:

| Option | Behavior |
|--------|----------|
| A | Keep auto_approve_all flag | For automation scenarios |
| B | Remove it (security concern) | Approvals always enforced |
| C | Scope it: `auto_approve_tools: ["safe_tool_1"]` | Granular control |

**Please confirm your preference.**

### Q4: Workflow Task-Level Approval?

The old design had separate task-level approval (beyond tool-level).

**Options**:

| Option | Behavior |
|--------|----------|
| A | Keep task-level approval | Two approval points possible |
| B | Remove it, only tool-level | Simpler, tool is the unit of work |

**My recommendation**: B (tool-level only for MVP, add task-level if users request)

**Please confirm your preference.**

### Q5: Skip Action - What Happens to LLM?

When user skips a tool call:

**Options**:

| Option | Behavior |
|--------|----------|
| A | Tool returns null, LLM continues blindly | Simple but may confuse LLM |
| B | Tool returns "skipped by user" message | LLM can adapt |
| C | Re-prompt LLM "user skipped, what next?" | Most intelligent but complex |

**Please confirm your preference.**

---

## Part 4: Research Required

### LangGraph Interrupt/Resume Mechanics

Before implementation, we MUST understand:

1. **How does LangGraph handle interrupt?**
   - Is there a `NodeInterrupt` exception?
   - Or is there a state-based pause mechanism?

2. **Checkpoint storage and resume**
   - Where is checkpoint stored?
   - How do we resume from specific checkpoint?
   - Can we modify state before resume?

3. **Skip action implementation**
   - How do we inject "tool was skipped" into LLM context?
   - Does LangGraph support this natively?

**Proposed**: Dedicated research task (1 day) before any implementation.

---

## Part 5: Implementation Phases (Pending Design Decisions)

Once design decisions are confirmed:

### Phase 1: Proto Contracts (2 days)
- Add approval fields to ToolCall
- Add ApprovalStatus enum
- Add PendingApproval to AgentExecutionStatus
- Add SubmitApproval RPC
- Regenerate stubs

### Phase 2: LangGraph Research (1 day)
- Interrupt/resume mechanics
- Checkpoint management
- Skip implementation options

### Phase 3: Agent Service - Direct Agent Approval (3-4 days)
- Implement approval check before tool execution
- LangGraph interrupt on approval needed
- Resume handler for three actions
- Unit tests

### Phase 4: Sub-Agent Approval Propagation (2-3 days)
- Detect sub-agent waiting for approval
- Bubble approval to main agent
- Forward decision to sub-agent

### Phase 5: Workflow Integration (3-4 days)
- Detect agent child waiting for approval
- Expose approval at workflow level
- Forward decision to agent child

### Phase 6: API Handlers (2 days)
- SubmitApproval handler in Java
- Validation and error handling
- Audit logging

### Phase 7: Integration Testing (2-3 days)
- All scenarios end-to-end
- Race condition testing
- Timeout/failure scenarios

---

## Success Criteria

### Must Have (MVP)
- [ ] Direct agent invocation pauses for tool approval
- [ ] Three actions work: Approve, Skip, Reject
- [ ] ToolCall proto shows approval state during streaming
- [ ] CLI can display approval prompt and accept input

### Should Have
- [ ] Sub-agent approval propagation
- [ ] Workflow-to-agent approval propagation

### Nice to Have (Future)
- [ ] Auto-approve mode
- [ ] Task-level approval (separate from tool)
- [ ] Approval timeout configuration

---

## Review Questions for You

1. **Q1**: Approval policy location - which option?
2. **Q2**: Sub-agent propagation depth - which option?
3. **Q3**: Auto-approve mode - keep/remove/scope?
4. **Q4**: Task-level approval - keep or remove for MVP?
5. **Q5**: Skip action semantics - which option?

6. **Additional**: Any scenarios or edge cases I'm missing?
7. **Priority**: Which execution context (direct agent / workflow / sub-agent) is most important to deliver first?

---

**Please review and provide your decisions. I'll revise the plan based on your feedback.**
