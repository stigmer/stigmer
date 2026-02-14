---
name: Fix CLI Execution UX
overview: "Fix three critical UX issues in the CLI agent execution flow: missed approval prompts, purposeless post-execution menu, and broken phase/message ordering. The core problem is that the CLI models execution as passive observation rather than active supervision."
todos:
  - id: bug1-dual-track-approval
    content: Add tool-call-level approval detection in run_stream.go as defense-in-depth alongside phase-based detection. Add findUnpromptedApproval(), handleToolCallApproval(), countUnresolvedApprovals() to run_stream_approval.go. Change lastPendingToolCallID to promptedToolCallIDs set.
    status: completed
  - id: bug2-remove-post-exec-menu
    content: Delete post_exec_menu.go entirely. Remove the post-exec menu loop from draft_skill_handler.go (lines 99-112). Verify no other commands reference showPostExecMenu or displayConversation.
    status: completed
  - id: bug3-reorder-stream-loop
    content: "Reorder the streaming loop in run_stream.go: messages first, then approval check, then phase display, then terminal check. Apply same reordering to streamWorkflowExecution()."
    status: completed
  - id: terminal-guard
    content: Add terminal-phase guard in run_stream.go that warns if execution completed with unresolved approval requests.
    status: completed
  - id: tests
    content: Update existing tests in run_display_summary_test.go and run_display_test.go. Add tests for findUnpromptedApproval and countUnresolvedApprovals.
    status: completed
isProject: false
---

# Fix CLI Agent Execution UX

## Domain Analysis

The CLI's execution streaming loop treats the human as a **passive observer** who occasionally gets asked for approval. This is architecturally wrong. In the Stigmer domain, the human running the CLI is the **supervisor** of the agent execution. The supervision contract demands:

1. **Every approval-required tool call MUST be presented to the supervisor.** Missing one breaks the contract.
2. **The execution MUST NOT silently complete if a tool call needed approval that was never given.**
3. **The display MUST reflect chronological reality** -- the user should never see "completed" while tool calls are still unresolved.

The three bugs are symptoms of this single modeling error.

---

## Bug 1: Missed Approval Prompt (Critical)

### Root Cause

In `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)` (lines 76-89), approval detection depends entirely on catching the execution phase `EXECUTION_WAITING_FOR_APPROVAL`:

```go
if needsAgentApprovalPrompt(
    execution.Status.Phase,               // <-- transient phase
    execution.Status.GetPendingApproval(),
    lastPendingToolCallID,
) { ... }
```

If the backend transitions through this phase between two gRPC `stream.Recv()` calls (which happens when the server processes fast or batches updates), the CLI never sees it. The tool call sits in `waiting_approval` but the execution phase has already moved past it.

### Fix: Dual-Track Approval Detection

Add a **second, independent** approval detection mechanism based on tool call statuses, not just the execution phase. This provides defense-in-depth:

**Track 1 (existing)**: Detect `EXECUTION_WAITING_FOR_APPROVAL` phase (works when the CLI catches the phase).

**Track 2 (new)**: After rendering messages, scan `execution.Status.ToolCalls` for any tool call with status `TOOL_CALL_WAITING_APPROVAL` that hasn't been prompted yet. If found, trigger the approval flow even if the execution phase has moved on.

The new check should go in `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)` after message rendering (line ~101) and BEFORE the terminal phase check (line ~106):

```go
// Track 2: Tool-call-level approval detection (defense-in-depth).
// Catches approvals missed by phase detection due to transient phases.
if tc := findUnpromptedApproval(execution.Status.ToolCalls, promptedToolCallIDs); tc != nil {
    sp.Stop()
    if err := handleToolCallApproval(ctx, conn, executionID, tc, prompter, defaultAction); err != nil {
        return nil, errors.Wrap(err, "agent approval failed")
    }
    promptedToolCallIDs[tc.Id] = true
    sp.Start("Resuming after approval...")
}
```

Implementation:

- Add a `findUnpromptedApproval()` function in `[run_stream_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_approval.go)` that iterates `ToolCalls` and returns the first one with `TOOL_CALL_WAITING_APPROVAL` status not in the prompted set.
- Change `lastPendingToolCallID string` to `promptedToolCallIDs map[string]bool` (a set) to track all prompted tool calls, not just the last one.
- Build a `handleToolCallApproval()` that constructs the approval display from the `ToolCall` fields (name, args) rather than relying on the `PendingApproval` proto message. Fall back to `PendingApproval` if available.

### Terminal-Phase Guard

Additionally, before returning on a terminal phase, check for unresolved approvals and warn:

```go
if isTerminalAgentPhase(execution.Status.Phase) {
    if unresolved := countUnresolvedApprovals(execution.Status.ToolCalls, promptedToolCallIDs); unresolved > 0 {
        cliprint.PrintWarning("%d tool call(s) required approval but were not prompted", unresolved)
    }
    // ... render summary and return
}
```

---

## Bug 2: Remove Post-Execution Menu

### Root Cause

The post-execution menu in `[post_exec_menu.go](client-apps/cli/cmd/stigmer/root/post_exec_menu.go)` and the loop in `[draft_skill_handler.go](client-apps/cli/cmd/stigmer/root/draft_skill_handler.go)` (lines 99-112) exist because the CLI wasn't confident the user got everything they needed during streaming. With proper streaming, approval, and summary display, the menu is unnecessary.

### Fix: Replace with Clean Contextual Exit

Remove the post-execution menu loop entirely. The handler should exit cleanly after showing the summary and artifacts:

In `[draft_skill_handler.go](client-apps/cli/cmd/stigmer/root/draft_skill_handler.go)`, replace lines 99-112:

```go
// BEFORE (menu loop):
for {
    action := showPostExecMenu()
    switch action { ... }
}

// AFTER (clean exit):
return nil
```

The execution summary panel + artifact download message already provide everything the user needs. If the user wants to inspect the conversation later, that is what `stigmer get execution <id>` is for -- it should not be bolted onto the execution flow.

### File Changes

- `[draft_skill_handler.go](client-apps/cli/cmd/stigmer/root/draft_skill_handler.go)`: Remove the post-exec menu loop (lines 99-112).
- `[post_exec_menu.go](client-apps/cli/cmd/stigmer/root/post_exec_menu.go)`: Delete this file entirely. It is a UX anti-pattern -- presenting post-hoc review options that should have been visible during execution.
- Verify no other command references `showPostExecMenu` or `displayConversation`.

---

## Bug 3: Fix Phase/Message Rendering Order

### Root Cause

In the streaming loop (`[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)` lines 55-111), the operations execute in this order per iteration:

1. **Phase change display** (line 66) -- prints "Execution completed"
2. Approval check (line 77)
3. **Message rendering** (line 94) -- prints remaining tool calls
4. **Terminal check** (line 106) -- exits

This means "Execution completed" prints BEFORE any remaining tool calls are rendered. The user sees a completed status followed by a tool in `waiting_approval` -- contradictory and confusing.

### Fix: Messages-First Ordering

Reorder the streaming loop so messages render BEFORE phase transitions display:

```go
for {
    execution, err := stream.Recv()
    // ... error handling ...

    // Step 1: Render messages FIRST (show what happened before status changes)
    rendered, streaming := renderer.render(execution.Status.Messages)
    if rendered { sp.Stop() }
    if rendered && !streaming { sp.Start("Agent is thinking...") }

    // Step 2: Tool-call-level approval detection
    if tc := findUnpromptedApproval(execution.Status.ToolCalls, promptedToolCallIDs); tc != nil {
        sp.Stop()
        // ... handle approval ...
    }

    // Step 3: Phase-level approval detection (existing, kept as primary track)
    if needsAgentApprovalPrompt(...) {
        sp.Stop()
        // ... handle approval ...
    }

    // Step 4: Phase change display (AFTER messages are flushed)
    if execution.Status.Phase != lastPhase {
        sp.Stop()
        displayAgentPhaseChange(execution.Status.Phase)
        lastPhase = execution.Status.Phase
        if !isTerminalAgentPhase(lastPhase) {
            sp.Start(spinnerLabelForAgentPhase(lastPhase))
        }
    }

    // Step 5: Terminal check
    if isTerminalAgentPhase(execution.Status.Phase) {
        sp.Stop()
        displayAgentExecutionComplete(execution)
        return execution, nil
    }
}
```

This ensures the user always sees: tool calls rendered -> approval prompt (if any) -> phase transition -> summary. Chronologically correct.

Apply the same reordering to `streamWorkflowExecution()`.

---

## Summary of File Changes


| File                                                                                | Action                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)`                   | Reorder loop (messages -> approval -> phase -> terminal); add tool-call-level approval track; change `lastPendingToolCallID` to `promptedToolCallIDs` set |
| `[run_stream_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_approval.go)` | Add `findUnpromptedApproval()`, `handleToolCallApproval()`, `countUnresolvedApprovals()`                                                                  |
| `[draft_skill_handler.go](client-apps/cli/cmd/stigmer/root/draft_skill_handler.go)` | Remove post-exec menu loop (lines 99-112)                                                                                                                 |
| `[post_exec_menu.go](client-apps/cli/cmd/stigmer/root/post_exec_menu.go)`           | Delete entirely                                                                                                                                           |
| `[run_handlers.go](client-apps/cli/cmd/stigmer/root/run_handlers.go)`               | Apply same loop reorder if `stigmer run` uses similar pattern                                                                                             |


---

## Architecture Principle

The streaming loop should follow one invariant:

> **Render content before status. Prompt before proceeding. Never exit with unresolved approvals.**

This turns the CLI from a passive observer into an active supervisor -- which is what the domain demands.