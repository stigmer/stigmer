# T01: Sub-Agent Execution Streamline — Detailed Plan

**Created**: 2026-03-09
**Status**: APPROVED

---

## How Sub-Agents Work Today (Current State)

### The Flow

When a user chats with an agent, the LLM can decide to delegate work to a sub-agent. It does this by calling a tool named `"task"`. The task tool args look like:

```json
{
  "subagent_type": "generalPurpose",
  "description": "Explore CLI rendering code",
  "prompt": "Find all files related to sub-agent rendering in the CLI..."
}
```

LangGraph's DeepAgents library handles the actual sub-agent graph execution. The agent-runner receives events from `astream_events` for both the main agent and sub-agent, distinguished by a `langgraph_checkpoint_ns` metadata field.

### Three Layers

1. **Proto** (`apis/ai/stigmer/agentic/agentexecution/v1/api.proto`): Defines the `SubAgentExecution` message that lives inside `AgentExecutionStatus.sub_agent_executions`.

2. **Agent Runner** (`backend/services/agent-runner/worker/activities/graphton/status_builder.py`): A Python `StatusBuilder` class processes LangGraph events and builds the proto status. It detects "task" tool invocations, creates `SubAgentExecution` entries, routes sub-agent events by namespace, and tracks lifecycle.

3. **CLI** (`client-apps/cli/cmd/stigmer/root/run_stream_*.go`): A Go Bubbletea TUI that receives streamed `AgentExecution` status updates, extracts sub-agent changes via `emitSubAgentEvents`, and renders them with visual nesting (gutter-wrapped `│` prefix).

---

## Gap 1: `description` is hidden in opaque metadata; `subject` is LLM-generated overhead

> **UPDATE (2026-03-09)**: The proto field stays as `subject` (not renamed to `description`) to preserve semantic accuracy and eliminate rename blast radius. The population mechanism changes: `subject` is populated directly from `tool_args.get("description", "")` instead of an LLM call. See `design-decisions/DD-02_subject-from-description-arg.md`, `design-decisions/DD-03_cli-label-task-to-subagent.md`, and `design-decisions/DD-04_no-fallback-for-empty-subject.md`.

### What's Wrong

The task tool provides a `description` arg (e.g., "Explore CLI rendering code") which is the LLM's own concise label for the sub-agent's purpose. But `_handle_sub_agent_start` in `status_builder.py` (line ~2531) stashes this into a protobuf `Struct` metadata field:

```python
metadata = Struct()
if sub_agent_description:
    metadata.update({"description": sub_agent_description})
```

Then it makes a *separate LLM call* via `_generate_sub_agent_subject()` to generate a `subject` field — essentially asking an economy-tier model to summarize what the LLM already summarized. This is redundant latency and cost.

On the CLI side (`run_stream_subagent.go` line ~49), the display logic first tries `sa.GetSubject()`, then falls back to digging into the opaque metadata:

```go
desc := sa.GetSubject()
if desc == "" {
    if sa.Metadata != nil {
        if v, ok := sa.Metadata.Fields["description"]; ok {
            desc = v.GetStringValue()
        }
    }
}
```

### What Needs to Change

**Proto** (`api.proto` — `SubAgentExecution` message):
- Field 13 (`subject`) stays as `subject`. Documentation updated to reflect direct population from task tool `description` arg (done in PR1).

**Runner** (`status_builder.py` — PR2):
- In `_handle_sub_agent_start`: Set `subject = tool_args.get("description", "")` directly.
- Delete `_generate_sub_agent_subject()` function and all supporting code.
- Stop putting description into the `metadata` Struct.

**CLI** (PR4):
- Rename hardcoded "Task" label to "Sub-agent" in all render paths (see DD-03).
- Remove all fallback/defensive code for empty `subject` — display empty if empty (see DD-04).
- `SubAgentStartedEvent.Description` is set directly from `sa.GetSubject()` with no fallback.

---

## ~~Gap 2: No explicit link between SubAgentExecution and its spawning "task" tool call~~

**STATUS: DROPPED** — See `design-decisions/DD-01_drop-parent-tool-call-id.md`

`SubAgentExecution` IS the domain entity for the "task" tool invocation. It already carries `id` (matches run_id), `input`, `output`, `status`, timestamps, `tool_calls`, `messages`, and `usage`. Creating a separate `ToolCall` for "task" and linking via `parent_tool_call_id` would be an anemic model — duplicating a richer domain entity with a hollow shell. The existing `return` in `_process_tool_start` (line 611) is the correct behavior.

---

## Gap 3: Sub-agent output is captured but never displayed

### What's Wrong

When a sub-agent completes, `_handle_sub_agent_end` (line ~2597 of `status_builder.py`) properly captures the output:

```python
sub_agent.output = output
```

The CLI's `SubAgentCompletedEvent` (line ~92 of `run_stream_subagent.go`) carries this output:

```go
events <- executiontui.SubAgentCompletedEvent{
    ID:        sa.Id,
    Status:    status,
    ToolCount: len(sa.ToolCalls),
    Output:    sa.Output,
}
```

And it's stored in the block (`run_stream_inline_render.go`):

```go
block.output = e.Output  // stored but never used in rendering
```

But `renderSubAgentExpanded` in `run_stream_inline_history.go` (line 375) only iterates over `block.children` — it never touches `block.output`:

```go
func renderSubAgentExpanded(header string, block *subAgentBlock, opts toolrender.CompactOptions) string {
    var b strings.Builder
    b.WriteString(header)
    for _, child := range block.children {
        // ... renders tool calls, AI messages, etc.
    }
    // block.output is NEVER rendered here
    var footer string
    // ... just renders "✓ Done (N tools)"
}
```

The user never sees what the sub-agent concluded or returned.

### What Needs to Change

**CLI** (`run_stream_inline_history.go` — `renderSubAgentExpanded`):
- After the `block.children` loop and before the footer, render `block.output` if non-empty.
- Visual treatment: gutter-wrapped, dimmed, possibly truncated with expand-on-demand. Something like:

```
  │ Result: The CLI rendering code is spread across 12 files in...
  ✓ Done (3 tools)
```

- For collapsed view (`renderSubAgentCollapsed`): Consider showing a one-line truncated output summary. Currently it's just `"● Task: label ✓ Done (3 tools)"`. Could become `"● Task: label ✓ Done (3 tools) — Found 12 relevant files..."`.

---

## Gap 4: No `pending_approvals` on SubAgentExecution

### What's Wrong

When a sub-agent's tool needs approval, the `PendingApproval` is appended to the *parent* `AgentExecutionStatus.pending_approvals` (line ~734 of `status_builder.py`):

```python
self._populate_pending_approval(
    run_id=run_id,
    tool_name=tool_name,
    tool_args=tool_args,
    approval_message=rendered_message,
    from_sub_agent=from_sub_agent,
    sub_agent_name=sub_agent_name,
)
```

The parent level is correct for top-level visibility. But the `SubAgentExecution` itself has no record that it's blocked on approval. If you ever query a sub-agent in isolation (future web UI detail panel, API consumer), you can't tell it's waiting.

### What Needs to Change

**Proto** (`api.proto` — `SubAgentExecution` message): Add:

```protobuf
// Approval requests pending within this sub-agent's tool calls.
// Also surfaced at parent AgentExecutionStatus.pending_approvals for top-level visibility.
repeated PendingApproval pending_approvals = 16;
```

**Runner** (`status_builder.py` — `_populate_pending_approval`):
- When `from_sub_agent=True`, find the corresponding `SubAgentExecution` in `_active_sub_agents` and append the `PendingApproval` to its `pending_approvals` field.
- Continue also appending to parent `status.pending_approvals` (unchanged).
- On approval resolution (`clear_pending_approval` or equivalent): also clear from the sub-agent's `pending_approvals`.

---

## Gap 5: Approval prompts don't show sub-agent context

### What's Wrong

The `ApprovalNeededEvent` in `pkg/executiontui/events.go` has `FromSubAgent` and `SubAgentName` fields. But when the approval question is presented to the user, `resolveApprovalContext` in `run_stream_inline_approval_display.go` (line 37) only returns a `ToolCallInfo` — the sub-agent identity is not passed into the approval prompt text.

The user sees: `Approve: delete_file?`
They should see: `Sub-agent 'code-reviewer' needs approval: delete_file?`

### What Needs to Change

**CLI** (`run_stream_inline_approval_display.go`):
- `resolveApprovalContext` already returns `subAgentID`. The approval rendering code needs to use it.
- When `subAgentID != ""`: prepend the sub-agent name to the approval header/question.
- The sub-agent name is available from the `PendingApproval.sub_agent_name` field.

**CLI** (`run_stream_events.go` — `emitAndWaitApproval`):
- Ensure `pa.SubAgentName` is threaded through to the `ApprovalNeededEvent` and available at prompt render time.

---

## Gap 6: Sub-agent input (the task prompt) is never shown to the user

### What's Wrong

The `SubAgentStartedEvent` (in `events.go`) carries `ID`, `Name`, and `Description` — but not `Input`. The sub-agent's input is the full task prompt that tells it what to do (e.g., "Find all files related to sub-agent rendering in the CLI and return the full contents..."). This can be long and detailed.

Currently the user has no way to see what the sub-agent was asked to do. In Cursor, clicking on a sub-agent shows you the task prompt. We should at least make it available in expanded view.

### What Needs to Change

**CLI** (`pkg/executiontui/events.go`):
- Add `Input string` to `SubAgentStartedEvent`.

**CLI** (`run_stream_subagent.go` — `emitSubAgentEvents`):
- Set `Input: sa.Input` when creating `SubAgentStartedEvent`.

**CLI** (`run_stream_inline_render.go`):
- Store `Input` in the `subAgentBlock` struct.

**CLI** (`run_stream_inline_history.go` — `renderSubAgentExpanded`):
- In expanded view, render the input as a dimmed/truncated section before the children. Something like:

```
● Task: Explore CLI rendering code
  │ Prompt: Find all files related to sub-agent rendering...
  │ ● Grep: "SubAgent" in client-apps/cli/  ✓
  │ ● Read: run_stream_subagent.go  ✓
  │ Result: Found 12 files handling sub-agent rendering...
  ✓ Done (3 tools)
```

---

## Gap 7: Namespace routing is heuristic-based, breaks with concurrent sub-agents

### What's Wrong

`_register_sub_agent_namespace` in `status_builder.py` (line 2413) uses four fallback strategies to map LangGraph checkpoint namespaces to sub-agent IDs:

1. **Root-prefix matching**: namespaces sharing the same root segment (before `|`) map to the same sub-agent.
2. **Substring matching**: checks if any active sub-agent's run_id appears in the namespace.
3. **Causal correlation**: `_pending_sub_agent_id` from the last "task" start.
4. **Sole-active fallback**: when only one sub-agent is active, all multi-segment namespaces map to it.

Strategy 4 is the problem. When two sub-agents run concurrently, it cannot disambiguate. Events from sub-agent B could get attributed to sub-agent A. This means tool calls and messages end up in the wrong `SubAgentExecution` — silent data corruption.

The warning at line 2506 fires but nothing is recovered:

```python
if is_multi_segment and namespace not in self._warned_namespaces:
    self._warned_namespaces.add(namespace)
    self.logger.warning(...)
```

### What Needs to Change

**Investigation needed**: Check if LangGraph's `astream_events` metadata carries a deterministic identifier linking sub-agent events to the parent task tool's `run_id`. If so, that becomes the primary routing strategy and all heuristics become fallbacks.

**Runner** (`status_builder.py`):
- Add structured logging/metrics when each strategy fires. Today we only have debug/info logs — we need to track *how often* strategies 3 and 4 are used in production to quantify the risk.
- Write a test case with 2+ simultaneous sub-agents to verify correct routing (or document the known failure mode).
- Consider: if routing fails, should the event be dropped rather than misattributed to the main agent? Misattribution is worse than data loss.

---

## Gap 8: `_handle_sub_agent_end` silently drops unmatched completions

### What's Wrong

In `_handle_sub_agent_end` (line 2594 of `status_builder.py`):

```python
for sub_agent in self.current_status.sub_agent_executions:
    if sub_agent.id == run_id:
        sub_agent.output = output
        # ...
        break
```

If no match is found, nothing happens. No warning, no metric. A sub-agent could stay in `IN_PROGRESS` forever because its completion event was lost (e.g., the `run_id` in the `on_tool_end` event doesn't match the `run_id` from `on_tool_start` — which can happen if LangGraph reuses or transforms run IDs).

### What Needs to Change

**Runner** (`status_builder.py` — `_handle_sub_agent_end`):
- Add an `else` clause after the `for` loop (using a `found` flag or for/else pattern) that logs a warning with the `run_id` and lists active sub-agent IDs.
- This is purely defensive — ensures the failure mode is visible.

---

## Gap 9: Late events after sub-agent end get misrouted

### What's Wrong

`_handle_sub_agent_end` (line 2612) immediately removes namespace mappings:

```python
if run_id in self._active_sub_agents:
    del self._active_sub_agents[run_id]

namespaces_to_remove = [
    ns for ns, sa_id in self._namespace_to_sub_agent_id.items()
    if sa_id == run_id
]
for ns in namespaces_to_remove:
    del self._namespace_to_sub_agent_id[ns]
```

But LangGraph event ordering is not strictly guaranteed. Events from a sub-agent's graph nodes can arrive *after* the `on_tool_end` for the task tool. These late events would find no namespace mapping and fall through to `_get_execution_context` returning `(self.current_status, None)` — they get attributed to the main agent.

### What Needs to Change

**Runner** (`status_builder.py`):
- Instead of deleting from `_active_sub_agents`, move completed sub-agents to a `_completed_sub_agents` dict.
- Keep their namespace mappings alive.
- `_get_execution_context` checks `_active_sub_agents` first, then `_completed_sub_agents` as fallback.
- Late events route to the completed sub-agent (which is fine — the proto is still in `sub_agent_executions`, just with terminal status).
- Clean up `_completed_sub_agents` periodically or on the next status flush.

---

## Gap 10: No sub-agent cancellation propagation

### What's Wrong

The `SubAgentStatus` enum has no `CANCELLED` value:

```protobuf
enum SubAgentStatus {
  SUB_AGENT_STATUS_UNSPECIFIED = 0;
  SUB_AGENT_PENDING = 1;
  SUB_AGENT_IN_PROGRESS = 2;
  SUB_AGENT_COMPLETED = 3;
  SUB_AGENT_FAILED = 4;
  // No CANCELLED
}
```

When the parent execution is cancelled, active sub-agents remain in `IN_PROGRESS` in the persisted status. There's no mechanism in `execute_graphton.py`'s cancellation handler to transition them.

### What Needs to Change

**Proto** (`enum.proto`): Add `SUB_AGENT_CANCELLED = 5;`.

**Runner** (`execute_graphton.py` — cancellation handler, and `status_builder.py`):
- Add a `cancel_active_sub_agents()` method to `StatusBuilder`.
- When parent execution is cancelled: iterate `_active_sub_agents`, set each to `SUB_AGENT_CANCELLED` with `completed_at` and `error = "Cancelled: parent execution was cancelled"`.
- Call this from the cancellation/termination handler in `execute_graphton.py`.

---

## Gap 11: `SubAgentCompletedEvent` uses untyped string status

### What's Wrong

In `pkg/executiontui/events.go`:

```go
type SubAgentCompletedEvent struct {
    ID        string
    Status    string  // "completed" or "failed" — stringly typed
    ToolCount int
    Output    string
}
```

And in `run_stream_subagent.go` (line 88):

```go
status := "completed"
if sa.Status == agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED {
    status = "failed"
}
```

This converts a proper proto enum into a magic string that consumers must string-match. If we add `SUB_AGENT_CANCELLED`, every consumer needs to know to check for the string "cancelled".

### What Needs to Change

**CLI** (`events.go`): Change `Status string` to `Status agentexecutionv1.SubAgentStatus` (the proto enum type).

**CLI** (`run_stream_subagent.go`): Pass `sa.Status` directly instead of converting to string.

**CLI** (all consumers): Switch from `block.status == "failed"` to `block.status == agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED`.

---

## Decisions Made (Not Gaps — Explicit Choices)

### No `current_activity` proto field

CLI can derive the current activity by scanning `SubAgentExecution.tool_calls` for any with `status == TOOL_CALL_RUNNING`. Sub-agents can trigger multiple tools in parallel, so a single `current_tool_name` field would be misleading. The CLI's `subAgentActivity` string (set via `subAgentActivityMsg`) already works from streaming events — no proto change needed.

### Nested sub-agents deferred

The current DeepAgent doesn't support sub-agent-calling-sub-agent. `SubAgentExecution` stays flat (no recursive `sub_agent_executions` field). If multi-hop delegation is added later, the model extends naturally.

### Origin-agnostic at execution time

`SubAgentExecution` captures any invoked sub-agent — whether it's a custom sub-agent defined in `AgentSpec.sub_agents` or the built-in general-purpose sub-agent from DeepAgents. The agent template definition and the execution output are independent concerns.

### Task tool visually suppressed — no separate ToolCall (DD-01)

No "task" `ToolCall` is created in `status.tool_calls`. `SubAgentExecution` IS the domain entity for the "task" tool invocation. The CLI suppresses "task" tool events via `IsTaskTool()` checks. Analytics needing sub-agent invocation counts should query `status.sub_agent_executions`, not `status.tool_calls`. See `design-decisions/DD-01_drop-parent-tool-call-id.md`.

---

## PR Sequence

| PR | What | Files | Depends On |
|----|------|-------|-----------|
| **PR1** | Proto model: update `subject` docs, add `pending_approvals`, `SUB_AGENT_CANCELLED`. Record design decisions (DD-01 to DD-04) | `api.proto`, `enum.proto`, design-decisions/ | — |
| **PR2** | Runner: remove subject LLM gen, use description arg directly, populate sub-agent pending_approvals | `status_builder.py`, possibly `execute_graphton.py` | PR1 |
| **PR3** | Runner: namespace robustness + late event handling + cancellation propagation + end-event guard | `status_builder.py`, `execute_graphton.py` | PR1 |
| **PR4** | CLI: display output, rename "Task" to "Sub-agent", remove fallback code, show sub-agent in approvals, typed status | `run_stream_subagent.go`, `events.go`, `run_stream_inline_history.go`, `run_stream_inline_approval_display.go`, `run_stream_inline_bubbletea.go`, `render.go` | PR1 |
| **PR5** | Tests: concurrent sub-agents, approval flow, output rendering, cancellation | `test_status_builder.py`, CLI test files | PR2–PR4 |

PR2, PR3, PR4 can be worked in parallel after PR1.

---

## Success Criteria

1. `stigmer run "complex task"` → sub-agent output is visible in both collapsed and expanded views.
2. When a sub-agent tool needs approval → prompt says "Sub-agent 'name' needs approval: tool_name" not just "Approve: tool_name?".
3. No LLM call to generate subject — `subject` is populated directly from task tool `description` arg; appears instantly.
4. CLI shows "Sub-agent: ..." (not "Task: ...") — no separate "Task" tool rendering.
5. ~~`SubAgentExecution` in stored status has `parent_tool_call_id` linking to a "task" ToolCall in `status.tool_calls`.~~ DROPPED (DD-01)
6. Cancelling a parent execution → all active sub-agents transition to `SUB_AGENT_CANCELLED`.
7. Late events after sub-agent completion route to the correct sub-agent, not the main agent.
8. `_handle_sub_agent_end` warns when no matching sub-agent is found.
9. CLI displays empty label when `subject` is empty — no fallback to `input`, `name`, or metadata.

---

## Review Process

**What happens next**:
1. You review this plan — focus on whether the gap descriptions match your understanding and whether any should be cut or reordered.
2. Provide feedback — I'll capture in T01_1_review.md.
3. Revise — T01_2_revised_plan.md.
4. Approve — execution begins, tracked per-PR.
