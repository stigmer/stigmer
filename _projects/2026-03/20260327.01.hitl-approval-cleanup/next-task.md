# Next Task: 20260327.01.hitl-approval-cleanup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260327.01.hitl-approval-cleanup

**Description**: Eliminate the root-level tool_calls duplication and the Python-managed pending_approvals shadow state. Tool calls live in messages only. Pending approvals become a server-side computed projection. Interrupt matching uses tool_call_id from the LangGraph checkpoint directly, eliminating all fuzzy matching.
**Goal**: Simplify the HITL approval flow to have two sources of truth (messages for tool calls, LangGraph checkpoint for interrupts) instead of six, eliminating the class of sync bugs that caused four cascading HITL fixes in a single day.
**Tech Stack**: Protobuf, Python/LangGraph, Java/Spring, Go, TypeScript/React
**Components**: Proto APIs (approval.proto, api.proto, message.proto, subagent.proto), Python agent-runner (status_builder, hitl, streaming, execute_graphton), Graphton core (tool_wrappers, interrupt_proxy), Java stigmer-service (UpdateStatusHandler, SubmitApprovalHandler, PendingApprovalMerger, InvokeAgentExecutionWorkflowImpl), Go stigmer-server (update_status, submit_approval, approval/merge), Go workflow-runner (task builders), React SDK (useSessionConversation), CLI (run_stream_snapshot, run_display_summary)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260327.01.hitl-approval-cleanup/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Task Map

| Task | Title | Status | Depends on |
|------|-------|--------|------------|
| **T01** | Research: tool_call_id availability at interrupt time | **COMPLETE** | — |
| T02 | Proto changes (remove tool_calls, simplify PendingApproval) | Not started | — |
| T03 | Python: single writer to messages, simplify HITL | Not started | T01, T02 |
| T04 | Add tool_call_id to interrupt payload | Not started | T01 |
| T05 | Java/Go: compute pending_approvals on write, simplify SubmitApproval | Not started | T02, T03 |
| T06 | React SDK: remove polling/staleness workarounds | Not started | T05 |
| T07 | Tests: rewrite for new architecture | Not started | T03, T04, T05 |

## Current Status

**Created**: 2026-03-27
**Current Task**: T01 COMPLETE. Next: T02 or T04 (both unblocked).
**Status**: T01 Complete — tool_call_id available via InjectedToolCallId, interrupt payload reduced to {tool_call_id, message}

## Session Progress (2026-03-27)

### Accomplished
- Completed T01 research: confirmed `tool_call_id` is available via LangChain's `InjectedToolCallId` annotation
- Validated compatibility with the `@tool(config: RunnableConfig, tool_call_id: Annotated[str, InjectedToolCallId], **kwargs)` signature pattern
- Decided on minimal interrupt payload: `{tool_call_id, message}` — removed 6 redundant fields
- Decided: no backward compatibility for `run_id` — clean break to `tool_call_id` as the single identity
- Decided: `_check_and_handle_approval` signature simplified from 7 params to 4
- Documented findings in `T01_2_execution.md` and design decision `002-minimal-interrupt-payload.md`

### Key Decisions
- **DD-002**: Interrupt payload reduced to `{tool_call_id, message}`. All display fields (`tool_name`, `tool_args`, `mcp_server`, `source`, `from_sub_agent`, `sub_agent_name`) already exist on the `ToolCall` in `messages[].tool_calls[]`. No duplication.
- **No backward compat**: `run_id` deleted from interrupt payload entirely. One identity, one field.
- **`message` stays temporarily**: The approval reason (`requirement.message`) stays in the interrupt payload because it's not yet on the `ToolCall` proto. Moves to `ToolCall.approval_message` in T02/T03.
- **Sub-agent proxy unchanged**: `InterruptProxyRunnable._build_proxy_payload` forwards interrupt value dicts as-is; `tool_call_id` flows through automatically.

### Context for Resume
- LangChain source was reviewed (upstream `main`, compatible with langchain-core 1.2.19). The `InjectedToolCallId` mechanism strips the param from the LLM schema, injects at invocation time via `_parse_input`.
- The `_injected_args_keys` fallback path also handles `tool_call_id` by key name for dict-based schemas.
- Recommend writing a unit test in T04 before changing all call sites to confirm end-to-end injection with `**kwargs`.

## Next Steps
1. **T02** (Proto changes): Remove `tool_calls` from `AgentExecutionStatus` and `SubAgentExecution`, simplify `PendingApproval`, delete `ApprovalLifecycleState`
2. **T04** (Add tool_call_id to interrupt): Implement the changes specified in `T01_2_execution.md` — `InjectedToolCallId` in tool wrappers, minimal interrupt payload
3. Both T02 and T04 are unblocked and can proceed in parallel

## Quick Commands

After loading context:
- "Pick next task" - Choose between T02 or T04
- "Show project status" - Get overview of progress
- "Review design decisions" - Check DD-001 and DD-002

---

*This file provides direct paths to all project resources for quick context loading.*
