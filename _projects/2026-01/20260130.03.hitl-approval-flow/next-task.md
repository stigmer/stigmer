# Next Task: HITL Approval Flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project Summary

**Description**: Human-in-the-loop approval system for agent tool execution. This is a fresh architectural design taking into account Phase 2 streaming improvements (sub-agents, ToolCall proto structure).

**Goal**: Design and implement approval flow that handles:
- Direct agent invocation (User → Agent → Tool)
- Workflow to agent (User → Workflow → Agent → Tool)
- Sub-agent nesting (User → Agent → Sub-Agent → Tool)

**Tech Stack**: Protocol Buffers, Python (LangGraph interrupt/resume), Go/Temporal (workflow signals), Java (gRPC handlers)

## Current Status

**Created**: 2026-01-30
**Last Session**: 2026-01-30
**Current Phase**: Phase 1 Complete - Proto Contracts Implemented
**Status**: IN_PROGRESS - Ready for Phase 2

---

## Session Progress (2026-01-30 - Phase 1 Implementation)

### Completed
1. **Phase 1: Proto Contracts - COMPLETE** (607 lines added across 7 files)
   - Added `TOOL_CALL_WAITING_APPROVAL`, `TOOL_CALL_SKIPPED` to `ToolCallStatus`
   - Added `EXECUTION_WAITING_FOR_APPROVAL` to `ExecutionPhase`
   - Added `ApprovalAction` enum (APPROVE, SKIP, REJECT)
   - Added `PendingApproval` message for UI display
   - Added 6 approval fields to `ToolCall` (fields 10-15)
   - Added `pending_approval` field to `AgentExecutionStatus`
   - Added `auto_approve_all` field to `AgentExecutionSpec`
   - Added `submitApproval` RPC to `AgentExecutionCommandController`
   - Added `SubmitApprovalInput` message with validation
   - Added `ToolApprovalPolicy` message and `default_tool_approvals` to `McpServerSpec`
   - Added `ToolApprovalOverride` message and `tool_approval_overrides` to `McpServerUsage`
   - Added `WORKFLOW_TASK_WAITING_APPROVAL` to `WorkflowTaskStatus`

2. **Stub Generation - COMPLETE**
   - All stubs regenerated (Java, Python, Go, TypeScript, Dart)
   - buf build passed
   - buf lint passed

### Key Design Decisions Implemented

| Decision | Implementation |
|----------|---------------|
| Approval policy location | **Hybrid**: McpServer.default_tool_approvals + Agent.tool_approval_overrides |
| Sub-agent propagation | **Automatic**: PendingApproval.from_sub_agent + sub_agent_name |
| Auto-approve mode | **Simple flag**: AgentExecutionSpec.auto_approve_all |
| Task-level approval | **Tool-only for MVP**: WORKFLOW_TASK_WAITING_APPROVAL for visibility |
| Skip semantics | **Return message**: TOOL_CALL_SKIPPED status, LLM receives skip message |

---

## Next Steps (Phase 2+)

### Phase 2: StatusBuilder Updates (~2 days)
- [ ] Add approval state tracking methods to StatusBuilder
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
- [ ] Implement `submitApproval` RPC handler
- [ ] Add validation (correct phase, matching tool_call_id)
- [ ] Signal the Temporal workflow to resume agent
- [ ] Add audit logging for approval decisions

### Phase 5: Workflow Integration (~2 days)
- [ ] Detect child agent waiting for approval
- [ ] Add `WORKFLOW_TASK_WAITING_APPROVAL` status handling
- [ ] Implement approval forwarding to child agent

### Phase 6: CLI Support (~1 day)
- [ ] Detect `EXECUTION_WAITING_FOR_APPROVAL` in streaming output
- [ ] Display approval prompt with tool details
- [ ] Accept user input (approve/skip/reject)
- [ ] Call SubmitApproval API

### Phase 7: Integration Testing (~2-3 days)
- [ ] Test direct agent + tool approval (all actions)
- [ ] Test auto_approve_all mode
- [ ] Test sub-agent approval propagation
- [ ] Test workflow-to-agent propagation

---

## Modified Files (Phase 1)

### stigmer (proto definitions)
```
apis/ai/stigmer/agentic/agentexecution/v1/enum.proto      (+77 lines)
apis/ai/stigmer/agentic/agentexecution/v1/api.proto       (+194 lines)
apis/ai/stigmer/agentic/agentexecution/v1/command.proto   (+81 lines)
apis/ai/stigmer/agentic/agentexecution/v1/spec.proto      (+26 lines)
apis/ai/stigmer/agentic/mcpserver/v1/spec.proto           (+100 lines)
apis/ai/stigmer/agentic/agent/v1/spec.proto               (+99 lines)
apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto   (+30 lines)
```

### stigmer-cloud (generated stubs)
All language stubs regenerated: Java, Python, Go, TypeScript, Dart

---

## Key Source Files (For Reference)

### Proto Definitions (MODIFIED)
```
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/api.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/enum.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/command.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/spec.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/mcpserver/v1/spec.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agent/v1/spec.proto
```

### Python Agent Runner (TO BE MODIFIED IN PHASE 2+)
```
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/worker/activities/graphton/status_builder.py
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py
```

### Java Handler (TO BE MODIFIED IN PHASE 4)
```
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/
```

---

## Resume Checklist

When starting a new session:

1. [ ] Review this file for current status
2. [ ] Check `checkpoints/2026-01-30-session-phase-1.md` for Phase 1 details
3. [ ] Verify proto changes are committed
4. [ ] Begin Phase 2: StatusBuilder Updates

## Quick Commands

After loading context:
- "Show Phase 1 implementation" - Review proto changes
- "Start Phase 2" - Begin StatusBuilder updates
- "Show approval flow" - Review the approval architecture

---

## Architecture Reference

### Approval Policy Chain
```
McpServer.default_tool_approvals → Agent.tool_approval_overrides → AgentExecution.auto_approve_all
```

### Key Proto Types Added
- `ApprovalAction` enum (APPROVE, SKIP, REJECT)
- `PendingApproval` message (UI surface)
- `ToolApprovalPolicy` message (MCP server defaults)
- `ToolApprovalOverride` message (Agent overrides)
- `SubmitApprovalInput` message (RPC input)

### Status Flow
```
TOOL_CALL_PENDING → TOOL_CALL_WAITING_APPROVAL → TOOL_CALL_RUNNING → TOOL_CALL_COMPLETED
                                              ↘ TOOL_CALL_SKIPPED (if user skips)
```

---

*This file provides direct paths to all project resources for quick context loading.*
