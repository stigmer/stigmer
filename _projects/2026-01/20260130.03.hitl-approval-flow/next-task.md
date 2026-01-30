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
**Last Session**: 2026-01-30 (Phase 3A Session)
**Current Phase**: Phase 3A Complete - Approval Config Wiring
**Status**: IN_PROGRESS - Ready for Phase 3B (LangGraph Interrupt)

---

## Session Progress (2026-01-30 - Phase 3A Implementation)

### Completed - Phase 3A: ApprovalConfig Wiring
**Duration**: ~1.5 hours | **Lines Added**: ~370 lines (net: +140 after refactoring)

#### What Was Accomplished
1. **Created `build_approval_config()` function** - Assembles `ApprovalConfig` from execution context
   - Location: `approval_policy.py` (kept with `ApprovalConfig` class for cohesion)
   - Pure function with no I/O, accepts proto objects or mocks
   - Handles all edge cases gracefully (missing fields, malformed data)
   - Extracts data from 4 sources: execution.spec, mcp_server_usages, mcp_servers, mcp_tools_config

2. **Wired ApprovalConfig into execute_graphton.py**
   - Moved `StatusBuilder` initialization from line 251 to line 611 (after MCP server fetch)
   - Added Step 5.6 to build `ApprovalConfig` with complete policy data
   - Passes `approval_config` to `StatusBuilder` constructor
   - Added `mcp_servers = []` initialization and reset in exception handlers

3. **Comprehensive Unit Tests** - Added `TestBuildApprovalConfig` class with 13 tests
   - All 112 tests pass (99 existing + 13 new)
   - Tests cover: empty inputs, auto_approve_all extraction, override collection, default policies, tool mapping
   - Tests verify graceful handling of malformed/missing data

#### Key Technical Decisions

| Decision | Implementation | Rationale |
|----------|---------------|-----------|
| Function location | `approval_policy.py` (not `execute_graphton.py`) | Keeps config builder with config class, avoids heavy import chain |
| StatusBuilder timing | Initialize after MCP fetch (line 611) | Needs complete MCP data to build ApprovalConfig |
| Error handling | Safe defaults for all missing fields | Production-ready, won't crash on malformed protos |
| Server slug fallback | Use `metadata.name` if `slug` missing | Handles legacy MCP servers without slug field |

#### Architecture Flow

```
execute_graphton.py
    │
    ▼
Step 5: Fetch MCP servers
    │
    ▼
Step 5.6: build_approval_config() ← NEW
    ├─ execution.spec.auto_approve_all
    ├─ mcp_server_usages[].tool_approval_overrides
    ├─ mcp_servers[].spec.default_tool_approvals
    └─ mcp_tools_config → tool_to_mcp_server mapping
    │
    ▼
StatusBuilder(execution_id, status, approval_config)
    │
    ▼
Tools matching policies → WAITING_APPROVAL status
```

#### What This Enables

Tools that match approval policies will now be correctly marked `WAITING_APPROVAL` instead of `RUNNING`. This is the foundation for the actual interrupt mechanism in Phase 3B.

#### What This Does NOT Do (Phase 3B Scope)

- Does NOT actually pause LangGraph execution
- Tools still execute even when marked WAITING_APPROVAL
- Phase 3B will add the LangGraph interrupt mechanism

---

## Session Progress (2026-01-30 - Phase 2 Implementation)

### Completed - Phase 2: StatusBuilder Approval State Management
**Duration**: ~3 hours | **Lines Added**: ~1,300+ lines

#### Phase 2.1: Approval Policy Resolution
**New File**: `backend/services/agent-runner/worker/activities/graphton/approval_policy.py` (420 lines)
- Created `ApprovalConfig` dataclass - holds approval policy configuration
- Created `ApprovalRequirement` dataclass - result of policy resolution
- Implemented `resolve_tool_approval()` - evaluates policy chain (auto_approve_all → agent_override → mcp_default)
- Implemented `render_approval_message()` - renders {{args.field}} placeholders with tool arguments
- Pure functions with no I/O for easy testing
- Safe defaults and nested argument support

#### Phase 2.2: State Management Methods
**Modified**: `status_builder.py` (+300 lines)
- Added `_pending_tool_approval` tracking state
- Added `_saved_phase_before_approval` for phase restoration
- Implemented `set_tool_waiting_approval()` - transitions tool to WAITING_APPROVAL, populates PendingApproval
- Implemented `set_tool_approval_decision()` - processes APPROVE/SKIP/REJECT decisions
- Implemented `clear_pending_approval()` - clears pending state and restores phase
- Implemented `_find_tool_call_by_id()` - finds ToolCall in main agent or sub-agents
- Implemented `_create_args_preview()` - sanitized JSON preview with sensitive data redaction

#### Phase 2.3: Tool Event Integration
**Modified**: `status_builder.py` (+200 lines)
- Added `approval_config` parameter to `__init__()` for optional approval policy
- Implemented `_check_tool_approval_requirement()` - resolves approval policy for a tool
- Implemented `_populate_pending_approval()` - sets up PendingApproval when approval required
- Modified `_handle_tool_start_event()` - checks approval before creating ToolCall
- Tools requiring approval now get `TOOL_CALL_WAITING_APPROVAL` status instead of `RUNNING`
- Execution phase transitions to `EXECUTION_WAITING_FOR_APPROVAL`
- Backward compatible: `approval_config=None` preserves existing RUNNING flow

#### Phase 2.4: Unit Tests
**Modified**: `test_status_builder.py` (+730 lines)
- Added `TestApprovalPolicyResolution` class (10 tests) - policy chain evaluation and message rendering
- Added `TestApprovalConfig` class (4 tests) - ApprovalConfig dataclass methods
- Added `TestToolWaitingApproval` class (7 tests) - set_tool_waiting_approval() behavior
- Added `TestToolApprovalDecision` class (8 tests) - APPROVE/SKIP/REJECT handling
- Added `TestToolStartApprovalIntegration` class (5 tests) - end-to-end tool start with approval
- Total: 34 new tests covering all approval functionality

### Key Technical Decisions

| Decision | Implementation | Rationale |
|----------|---------------|-----------|
| Policy chain evaluation | auto_approve_all → agent_override → mcp_default | Explicit priority order matching documentation |
| Message rendering | {{args.field}} with `<unknown>` fallback | Graceful handling of missing args |
| State tracking | Single `_pending_tool_approval` run_id | Only one tool can be pending at a time |
| Phase restoration | Saved phase restored on APPROVE/SKIP | Preserves execution state through approval flow |
| Args sanitization | Redact sensitive keys, truncate large values | Security-first approach for UI display |
| Backward compatibility | `approval_config=None` → normal RUNNING flow | No breaking changes to existing code |

### Architecture Patterns

**Policy Resolution**: Pure function composition
- Stateless policy evaluation
- Easy to test with simple dicts
- Clear separation from StatusBuilder state

**State Management**: Proto-first approach
- Direct proto manipulation for status updates
- Dual-reference pattern maintained (messages[] and tool_calls[])
- Event-driven state transitions

**Testing Strategy**: Fixture-based with real protos
- MagicMock for simple fields
- Real proto objects for CopyFrom() operations
- Isolated tests for each layer (policy, state, integration)

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

## Next Steps (Phase 3+)

### Phase 2: StatusBuilder Updates - ✅ COMPLETE
- [x] Add approval state tracking methods to StatusBuilder
- [x] Add `set_tool_waiting_approval()` method
- [x] Add `set_tool_approval_decision()` method
- [x] Update `_handle_tool_start_event()` to check approval requirements
- [x] Add unit tests for approval state management

### Phase 3A: ApprovalConfig Wiring - ✅ COMPLETE
- [x] Create `build_approval_config()` function
- [x] Move StatusBuilder init after MCP fetch, pass ApprovalConfig
- [x] Add comprehensive unit tests (13 new tests, all pass)

### Phase 3B: LangGraph Interrupt Mechanism (~2-3 days) - NEXT
**Goal**: Actually pause LangGraph execution when tool requires approval

**Investigation needed**:
- Research `graphton` library interrupt capabilities
- Understand LangGraph `interrupt_before`/`interrupt_after` patterns
- Determine if tool wrapper is needed vs graph-level interrupt
- Figure out resume mechanism after approval

**Implementation**:
- [ ] Research LangGraph interrupt/resume patterns in `graphton`
- [ ] Design interrupt mechanism (tool wrapper vs node interrupt)
- [ ] Implement pause at tool execution boundary
- [ ] Implement resume flow after approval decision
- [ ] Handle sub-agent approval surfacing
- [ ] Test interrupt/resume flow locally

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

## Modified Files (Phase 3A)

### stigmer (Python implementation)
```
backend/services/agent-runner/worker/activities/graphton/approval_policy.py    (+109 lines - build_approval_config function)
backend/services/agent-runner/worker/activities/execute_graphton.py            (+40 lines wiring, -110 lines removed duplicate)
backend/services/agent-runner/tests/test_status_builder.py                     (+227 lines - TestBuildApprovalConfig class)
.cursor/plans/phase_3a_approval_wiring_7818290e.plan.md                        (NEW - 200 lines)
```

**Net Changes**: +366 lines (3 modified files, 1 new plan file)

**Test Results**: All 112 tests pass ✅

---

## Modified Files (Phase 2)

### stigmer (Python implementation)
```
backend/services/agent-runner/worker/activities/graphton/approval_policy.py   (NEW - 420 lines)
backend/services/agent-runner/worker/activities/graphton/status_builder.py    (+492 lines)
backend/services/agent-runner/tests/test_status_builder.py                     (+730 lines)
apis/ai/stigmer/agentic/agentexecution/v1/io.proto                            (+54 lines - imports)
.cursor/plans/phase_2_statusbuilder_approval_2dfd773b.plan.md                 (NEW - 294 lines)
```

**Total Changes**: +1,990 lines (1 new file, 4 modified files)

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

### Python Agent Runner (MODIFIED IN PHASES 2 & 3A)
```
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/worker/activities/graphton/status_builder.py ✅ Phase 2
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/worker/activities/graphton/approval_policy.py ✅ Phases 2 & 3A
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/tests/test_status_builder.py ✅ Phases 2 & 3A
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py ✅ Phase 3A
```

### Java Handler (TO BE MODIFIED IN PHASE 4)
```
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/
```

---

## Resume Checklist

When starting a new session:

1. [ ] Review this file for current status
2. [ ] Check `checkpoints/` for session details:
   - `2026-01-30-session-phase-1.md` - Phase 1 proto contracts
   - `2026-01-30-session-phase-2.md` - Phase 2 StatusBuilder implementation
   - `2026-01-30-session-phase-3a.md` - Phase 3A ApprovalConfig wiring
3. [ ] Review uncommitted changes (Phases 1, 2, 3A not yet committed)
4. [ ] Begin Phase 3B: LangGraph Interrupt Mechanism

**Important Note for Phase 3B**: The subagent exploration revealed that tools currently execute even when marked `WAITING_APPROVAL`. Phase 3B requires deeper research into the `graphton` library to implement actual execution interruption.

## Quick Commands

After loading context:
- "Show Phase 1 implementation" - Review proto changes
- "Show Phase 2 implementation" - Review StatusBuilder approval logic
- "Start Phase 3" - Begin LangGraph integration
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
