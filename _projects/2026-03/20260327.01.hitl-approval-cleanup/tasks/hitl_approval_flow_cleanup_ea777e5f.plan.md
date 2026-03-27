---
name: HITL Approval Flow Cleanup
overview: Eliminate the root-level `tool_calls` duplication and the Python-managed `pending_approvals` shadow state. Tool calls live in messages only. Pending approvals become a server-side computed projection (computed on every UpdateStatus write, stored in DB). Interrupt matching uses `tool_call_id` from the LangGraph checkpoint directly, eliminating all fuzzy matching.
todos:
  - id: task1-research
    content: "Research: Verify tool_call_id is accessible at interrupt time in tool_wrappers.py. Trace LangChain/LangGraph tool invocation to find where tool_call_id from AIMessage lives in the RunnableConfig."
    status: pending
  - id: task2-proto
    content: "Proto changes: Remove tool_calls from AgentExecutionStatus and SubAgentExecution. Remove ApprovalLifecycleState. Simplify PendingApproval. Add args_preview to ToolCall. Regenerate all stubs."
    status: pending
  - id: task3-python
    content: "Python agent-runner: Make messages the single source of truth for tool calls. Rewrite StatusBuilder to stop maintaining flat list. Simplify hitl.py (delete InterruptCapture, ApprovalStateManager, CheckpointFallback). Rewrite ResumeReconciler for checkpoint-based resume."
    status: pending
  - id: task4-interrupt
    content: Add tool_call_id to interrupt payload in graphton/core/tool_wrappers.py and interrupt_proxy.py. Eliminate all fuzzy matching (run_id aliases, fingerprints, name fallback).
    status: pending
  - id: task5-java-go
    content: "Java/Go: Add ComputePendingApprovals step to UpdateStatus handlers. Simplify SubmitApproval to validate against tool call status. Delete PendingApprovalMerger. Remove flat tool_calls replacement logic."
    status: pending
  - id: task6-react
    content: "React SDK: Remove polling/staleness workarounds from useSessionConversation. Verify tool call rendering from messages is unaffected."
    status: pending
  - id: task7-tests
    content: "Rewrite tests across all layers: delete lifecycle/merger tests, add computed-projection tests, add checkpoint-resume tests, integration verification."
    status: pending
isProject: false
---

# HITL Approval Flow Cleanup — Complete Revamp

## The Problem (one sentence)

Approval state is maintained in 6 places across 4 languages, and every HITL bug traces back to keeping them in sync.

## The Target (one sentence)

Tool calls live in `messages[].tool_calls` only; `pending_approvals` is computed by Java/Go on every `UpdateStatus` write; interrupt matching uses `tool_call_id` from the checkpoint directly.

---

## Architectural Decisions

### Decision 1: Remove `repeated ToolCall tool_calls` from `AgentExecutionStatus`

- Remove field 3 from `AgentExecutionStatus` in [api.proto](apis/ai/stigmer/agentic/agentexecution/v1/api.proto)
- Remove field 10 from `SubAgentExecution` in [subagent.proto](apis/ai/stigmer/agentic/agentexecution/v1/subagent.proto)
- Tool calls exist ONLY inside `AgentMessage.tool_calls` (field 4 on [message.proto](apis/ai/stigmer/agentic/agentexecution/v1/message.proto))
- All tool call mutations (status transitions, results, approval fields) update the message-embedded copy
- CLI breakage is accepted — CLI will be revamped separately

### Decision 2: `pending_approvals` becomes a server-computed materialized projection

- Python NEVER writes to `pending_approvals`
- Java/Go `UpdateStatus` handler has a new step: **ComputePendingApprovals**
- This step scans `messages[].tool_calls` (and `sub_agent_executions[].messages[].tool_calls`), collects those with `status == WAITING_APPROVAL && requires_approval == true`, projects into `PendingApproval` entries
- The computed result is stored in DB alongside the rest of the status
- Every status update recomputes it — single logic, single location, always consistent
- `SubmitApproval` handler validates against tool call status directly, records decision on the `ToolCall` in the message
- Remove `PendingApprovalMerger` — no merge needed when the field is recomputed every time

### Decision 3: Add `tool_call_id` to interrupt payload, eliminate fuzzy matching

- Modify [tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py) to include `tool_call_id` in the `approval_request` dict passed to `interrupt()`
- At resume time, query `aget_state()` to get interrupts, read `tool_call_id` from each interrupt's value — direct mapping
- Delete the entire Priority 1/2/3 matching chain (`_run_id_aliases`, fingerprint maps, name fallback)
- Delete `InterruptCapture`, `ApprovalStateManager`, `CheckpointFallback` classes from [hitl.py](backend/services/agent-runner/worker/activities/graphton/hitl.py)

### Decision 4: Simplify `PendingApproval` proto

Remove lifecycle/decision fields that existed only for the distributed sync protocol:

- Remove `ApprovalLifecycleState` enum entirely from [approval.proto](apis/ai/stigmer/agentic/agentexecution/v1/approval.proto)
- Remove fields: `lifecycle_state`, `decision_action`, `decision_recorded_at`, `interrupt_id`
- Keep: `tool_call_id`, `tool_name`, `message`, `args_preview`, `requested_at`, `from_sub_agent`, `sub_agent_name`, `child_agent_execution_id`
- `PendingApproval` is now purely a UI-facing projection type

### Decision 5: Remove `pending_approvals` from `SubAgentExecution`

- Remove field 14 from `SubAgentExecution` in [subagent.proto](apis/ai/stigmer/agentic/agentexecution/v1/subagent.proto)
- The parent-level `pending_approvals` computed by Java/Go already covers sub-agent tool calls
- For `ChildApprovalNotification` (workflow signals), the signal payload still carries `PendingApproval` entries — this is a notification, not stored status

---

## Task Breakdown

### Task 1: Research — `tool_call_id` availability at interrupt time

**Goal:** Verify that `tool_call_id` is accessible inside `_check_and_handle_approval` in [tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py).

- Trace how LangChain/LangGraph invokes tools — is the tool_call_id from `AIMessage.tool_calls[].id` available in the `RunnableConfig` at tool execution time?
- If not natively available, determine how to thread it (e.g., via config metadata, custom callback, or tool input injection)
- This is the prerequisite for eliminating fuzzy matching — must be confirmed before Tasks 3-4

**Files to investigate:**

- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — where `interrupt()` is called
- `backend/libs/python/graphton/src/graphton/core/interrupt_proxy.py` — sub-agent interrupt forwarding
- LangChain/LangGraph source for tool invocation config shape

### Task 2: Proto changes

**Goal:** Clean up the data model.

Changes to [api.proto](apis/ai/stigmer/agentic/agentexecution/v1/api.proto):

- Remove `repeated ToolCall tool_calls = 3` from `AgentExecutionStatus`
- Keep `repeated PendingApproval pending_approvals = 16` (now server-computed, add comments reflecting new semantics)

Changes to [subagent.proto](apis/ai/stigmer/agentic/agentexecution/v1/subagent.proto):

- Remove `repeated ToolCall tool_calls = 10` from `SubAgentExecution`
- Remove `repeated PendingApproval pending_approvals = 14` from `SubAgentExecution`

Changes to [approval.proto](apis/ai/stigmer/agentic/agentexecution/v1/approval.proto):

- Delete `ApprovalLifecycleState` enum
- Remove fields 9-12 from `PendingApproval` (`interrupt_id`, `lifecycle_state`, `decision_action`, `decision_recorded_at`)
- Update all documentation to reflect computed-projection semantics

Changes to [message.proto](apis/ai/stigmer/agentic/agentexecution/v1/message.proto):

- Add `string args_preview = 18` to `ToolCall` — sanitized args preview for UI display (currently only on PendingApproval; needed for projection computation)

Regenerate all stubs (Go, Java, TypeScript, Python).

### Task 3: Python agent-runner — single writer to messages

**Goal:** Python writes tool call state ONLY to `messages[].tool_calls`. No more flat list, no more `pending_approvals` management.

Changes to [status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py) (~3,500 lines):

- Remove all writes to `current_status.tool_calls` (the flat list)
- All `append` calls that add ToolCalls to the flat list → add them to the parent AI message's `tool_calls` instead
- All status updates (status transitions, results, approval fields) → update the message-embedded copy via `_update_tool_call_on_ai_message()`
- Remove `_find_tool_call_by_id` on the flat list — replace with a message-scanning helper
- Remove `populate_fingerprints_from_existing_tool_calls` (fingerprints no longer needed)
- Remove `sync_sub_agent_pending_approvals`
- Populate `ToolCall.args_preview` when creating tool calls (move logic from `_create_args_preview` to tool call creation)

Changes to [hitl.py](backend/services/agent-runner/worker/activities/graphton/hitl.py) (~830 lines):

- Delete `ApprovalStateManager` class
- Delete `InterruptCapture` class
- Delete `CheckpointFallback` class (its logic becomes the primary resume path)
- Rewrite `ResumeReconciler` to be drastically simpler:
  - Receive `approval_decisions` (tool_call_id + action)
  - Query checkpoint via `aget_state()` to get interrupts
  - Match interrupts to decisions via `interrupt.value.tool_call_id`
  - Build `Command(resume={interrupt_id: decision})`
  - Update tool call statuses on messages (WAITING_APPROVAL -> RUNNING/SKIPPED)
  - No `pending_approvals` manipulation at all

Changes to [streaming.py](backend/services/agent-runner/worker/activities/graphton/streaming.py):

- Remove `_pre_stream_update` clear-signal sentinel logic
- Simplify heartbeat/logging to count tool calls from messages

Changes to `execute_graphton.py`:

- Remove INTERRUPT_CAPTURE block
- Remove RESUME_RECONCILE `pending_approvals` manipulation
- Simplify resume path to: query checkpoint -> match -> resume

### Task 4: Add `tool_call_id` to interrupt payload

**Goal:** Eliminate fuzzy matching by including `tool_call_id` in the interrupt value.

Changes to [tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py):

- In `_check_and_handle_approval`, add `tool_call_id` to the `approval_request` dict
- Source `tool_call_id` from the mechanism identified in Task 1

Changes to [interrupt_proxy.py](backend/libs/python/graphton/src/graphton/core/interrupt_proxy.py):

- Ensure `tool_call_id` is preserved in proxy payloads for sub-agent interrupts

### Task 5: Java/Go server — compute `pending_approvals` on write

**Goal:** Java and Go `UpdateStatus` handlers compute `pending_approvals` from tool call data in messages. `SubmitApproval` validates against tool call status directly.

**Java (stigmer-cloud):**

Changes to [AgentExecutionUpdateStatusHandler.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionUpdateStatusHandler.java):

- Add a `ComputePendingApprovalsStep` after `BuildNewStateWithStatus`
- This step scans `status.messages[].tool_calls` and `sub_agent_executions[].messages[].tool_calls`
- Collects ToolCalls with `status == WAITING_APPROVAL && requires_approval == true`
- Projects into `PendingApproval` entries (tool_call_id, tool_name, message from approval_message, args_preview, requested_at from approval_requested_at, from_sub_agent context)
- Overwrites `status.pending_approvals` with the computed list
- Remove all incoming `pending_approvals` merge logic from `BuildNewStateWithStatus`

Changes to [AgentExecutionSubmitApprovalHandler.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionSubmitApprovalHandler.java):

- Simplify validation: find the ToolCall in messages by `tool_call_id`, check `status == WAITING_APPROVAL`
- Record decision: set `approval_action`, `approval_decided_at` on the ToolCall in the message
- Remove all `pending_approvals` manipulation
- Remove lifecycle-based validation

Delete [PendingApprovalMerger.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/approval/PendingApprovalMerger.java) — no longer needed.

Changes to [UpdateExecutionStatusActivityImpl.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/activities/UpdateExecutionStatusActivityImpl.java):

- Remove flat `tool_calls` replacement logic (field no longer exists)
- Apply same `ComputePendingApprovals` logic

Changes to [InvokeAgentExecutionWorkflowImpl.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java):

- For `notifyParentWorkflowOfApprovals`: read from the now-computed `pending_approvals` on status (already computed by UpdateStatus) — this path simplifies
- Remove `pending_approvals` manipulation in signal handling

**Go (stigmer-server, OSS):**

Parallel changes to:

- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/update_status.go`
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/submit_approval.go`
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/update_status_impl.go`
- `backend/services/stigmer-server/pkg/domain/agentexecution/approval/merge.go` (delete)

**Workflow-level:**

- `WorkflowExecutionUpdateStatusHandler` (Java) and `workflowexecution/controller/update_status.go` (Go) — same pattern for workflow-level pending_approvals
- `workflow-runner` task builders — adapt to read computed pending_approvals

### Task 6: React SDK cleanup

**Goal:** Remove the workarounds that existed because `pending_approvals` was unreliable.

Changes to [useSessionConversation.ts](sdk/react/src/session/useSessionConversation.ts):

- Remove exponential backoff polling logic (`APPROVAL_POLL_INITIAL_MS`, etc.)
- Remove staleness detection logic (`STALE_DISMISSAL_MS`, `STALE_CHECK_INTERVAL_MS`)
- Remove `dismissedApprovalIds` Map-based timestamp tracking
- `pendingApprovals` is now a simple read from `execution.status.pendingApprovals` — always accurate because it's computed server-side on every write
- Tool call rendering already reads from `message.toolCalls` — verify no breakage from flat list removal

Verify no other SDK components depend on `execution.status.toolCalls` (investigation confirmed none do).

### Task 7: Tests

**Goal:** Replace the 17+ contract tests with simpler tests that reflect the new architecture.

**Python:**

- Delete or rewrite [test_hitl_contracts.py](backend/services/agent-runner/tests/test_hitl_contracts.py) — lifecycle state machine tests are gone
- Add tests for: resume-from-checkpoint flow (tool_call_id matching), tool call writes to messages only
- Update [test_status_builder.py](backend/services/agent-runner/tests/test_status_builder.py) — remove flat list assertions

**Java:**

- Rewrite `AgentExecutionSubmitApprovalHandlerTest.java` — test against tool call status validation
- Delete `PendingApprovalMergerTest.java`
- Add tests for `ComputePendingApprovalsStep`

**Go:**

- Rewrite `submit_approval_contract_test.go`
- Delete `merge_test.go` (approval merge)
- Add tests for computed pending_approvals logic

---

## Dependency Graph

```
Task 1 (Research tool_call_id) ─────────────────────────┐
                                                         ▼
Task 2 (Proto changes) ────────────────────────► Task 4 (tool_call_id in interrupt)
       │                                                 │
       ▼                                                 ▼
Task 3 (Python: single writer) ──────────► Task 5 (Java/Go: compute projections)
                                                         │
                                                         ▼
                                                Task 6 (React cleanup)
                                                         │
                                                         ▼
                                                Task 7 (Tests across all layers)
```

- Task 1 must complete first (unblocks Task 4)
- Task 2 is the proto foundation (unblocks Tasks 3, 4, 5)
- Tasks 3 and 5 can be developed in parallel once protos are ready
- Task 6 depends on Task 5 (server must be computing projections before we remove SDK workarounds)
- Task 7 runs alongside each task but has a final integration pass

---

## What This Eliminates

- `ApprovalLifecycleState` enum and all forward-only enforcement
- `PendingApprovalMerger` (Java + Go)
- `InterruptCapture` class (~200 lines)
- `ApprovalStateManager` class (~50 lines)
- `CheckpointFallback` class (~100 lines, logic becomes primary path)
- `ResumeReconciler` class rewritten from ~200 lines to ~50 lines
- `_run_id_aliases` dictionary and all run_id-based matching
- `_fingerprint_to_tool_call_id` dictionary and all fingerprint matching
- `sync_sub_agent_pending_approvals` helper
- Clear-signal sentinel pattern
- UI exponential backoff polling
- UI staleness detection
- Stale `approval_action` reset logic
- Phase 1 / Phase 2 collision cleanup
- The concept of "message-embedded copies being independent objects that need syncing" — there's now only ONE copy

## Risks and Open Questions

1. `**tool_call_id` availability (Task 1):** If it's not accessible at interrupt time, we need an alternative approach (e.g., storing a run_id-to-tool_call_id mapping in the LangGraph state, or using a deterministic derivation). This must be resolved before committing to Task 4.
2. **Streaming tool call timing:** During streaming, tool calls may be detected (via `on_tool_start`) before the parent AI message is finalized (via `on_chat_model_end`). The StatusBuilder currently adds them to the flat list immediately. With the new model, we need a strategy: either buffer them until the AI message is complete, or create the AI message shell immediately and append tool calls to it. This needs investigation during Task 3.
3. **MongoDB query patterns:** Any MongoDB queries that filter on `status.tool_calls` (e.g., "find executions with failed tool calls") will need to be updated to query `status.messages.tool_calls` instead. Need to audit existing queries.
4. **Proto field removal backward compatibility:** Removing proto fields is technically a breaking change. For `tool_calls` (field 3) and `pending_approvals` on SubAgentExecution (field 14), we should mark them as `reserved` in the proto to prevent future reuse of the field numbers.

