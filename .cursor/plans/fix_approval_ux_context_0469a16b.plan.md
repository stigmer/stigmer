---
name: Fix Approval UX Context
overview: The approval prompt in the TUI shows only bare action keys ([a]/[s]/[r]) with zero context about what's being approved. A pre-built `renderApprovalPrompt` function already exists and is tested but is dead code -- never wired into the event handler. The fix activates this function, threads sub-agent context through the approval pipeline, and fixes a blind spot in tool call lookup.
todos:
  - id: wire-approval-prompt
    content: Wire renderApprovalPrompt into ApprovalNeededEvent handler -- create blockApproval in handle_events.go, track approvalBlockIdx in model.go
    status: completed
  - id: thread-subagent-context
    content: Add FromSubAgent/SubAgentName to ApprovalNeededEvent (events.go), extract from PendingApproval proto (run_stream_events.go), render in prompt (render_approval.go)
    status: completed
  - id: cleanup-approval-block
    content: Replace approval block with renderApprovalConfirmation on user response in approval.go
    status: completed
  - id: fix-findtoolcallbyid
    content: Extend findToolCallByID in run_stream_convert.go to search SubAgentExecution.ToolCalls as fallback
    status: completed
  - id: enrich-footer
    content: Show tool name in approval footer in view.go, remove duplicate action keys from renderApprovalPrompt
    status: completed
  - id: update-tests
    content: Update existing tests for renderApprovalPrompt, approval.go, and extractApprovalInfo to cover new fields and behavior
    status: completed
isProject: false
---

# Fix Approval UX: Surface What the User is Approving

## Root Cause (Three Layers)

### 1. Dead `renderApprovalPrompt` -- the missing center

`[render_approval.go](client-apps/cli/pkg/executiontui/render_approval.go)` already has a `renderApprovalPrompt(toolName, argsPreview, message)` function that generates a contextual approval block:

```
APPROVAL REQUIRED

   Write file to disk: seedpack/skills/agent-creator/SKILL.md
   Tool: Write
   path: seedpack/skills/agent-creator/SKILL.md
   contents: (3.6 kB, 81 lines)
```

This function is **tested but never called** in production code. The `ApprovalNeededEvent` handler in `[handle_events.go:114-131](client-apps/cli/pkg/executiontui/handle_events.go)` only sets internal `m.approval` state and updates the tool block's badge. The user sees only the footer:

```
[a] Approve  [s] Skip  [r] Reject  [q] Detach
```

with no indication of what tool, what file, or what sub-agent is requesting approval.

### 2. Sub-agent context never reaches the TUI

The `PendingApproval` proto already carries `from_sub_agent` (bool) and `sub_agent_name` (string) -- populated by the backend in `[status_builder.py:2074-2118](backend/services/agent-runner/worker/activities/graphton/status_builder.py)`. But:

- `ApprovalNeededEvent` in `[events.go:157-162](client-apps/cli/pkg/executiontui/events.go)` has no sub-agent fields
- `extractApprovalInfo` in `[run_stream_events.go:532-558](client-apps/cli/cmd/stigmer/root/run_stream_events.go)` ignores `pa.FromSubAgent` and `pa.SubAgentName`

### 3. `findToolCallByID` is blind to sub-agent tool calls

`[run_stream_convert.go:65-75](client-apps/cli/cmd/stigmer/root/run_stream_convert.go)` only searches `execution.Status.ToolCalls` (top-level). Sub-agent tool calls live in `SubAgentExecution.ToolCalls`. When a sub-agent tool needs approval, `tc` is always nil. While `extractApprovalInfo` falls back to `PendingApproval`, this prevents richer context extraction.

## Clarification: Sub-Agent Streaming is Already Real-Time

Contrary to the initial concern, the architecture **does** stream sub-agent activity in real-time. The bridge processes sub-agent events (Step 1c in `streamToEvents`) **before** approval detection (Step 3). Sub-agent tool blocks with the pause badge are created before the approval prompt is shown. The user's confusion stems from the context-free approval footer, not from batched sub-agent events.

## Solution

### Change 1: Wire `renderApprovalPrompt` into the event handler

In `[handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)`, the `ApprovalNeededEvent` case should:

- Create a `blockApproval` using `renderApprovalPrompt` with the event's tool name, args preview, and message
- Append it to `m.blocks`
- Track its index in a new `approvalBlockIdx` field on the model

This surfaces the approval context directly in the viewport, right where the user's attention is.

### Change 2: Thread sub-agent context through the approval pipeline

- `**[events.go](client-apps/cli/pkg/executiontui/events.go)`**: Add `FromSubAgent bool` and `SubAgentName string` to `ApprovalNeededEvent`
- `**[run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)`**: Update `extractApprovalInfo` to also return `fromSubAgent` and `subAgentName` from the `PendingApproval` proto. Update `emitAndWaitApproval` to populate the new event fields.
- `**[render_approval.go](client-apps/cli/pkg/executiontui/render_approval.go)`**: Update `renderApprovalPrompt` to accept sub-agent info and display it when present (e.g., `Sub-agent: general-purpose -- Create skill directory`)

### Change 3: Clean up approval block on user response

In `[approval.go](client-apps/cli/pkg/executiontui/approval.go)`, when the user presses a/s/r:

- Replace the approval block content with a compact confirmation line using the existing `renderApprovalConfirmation` function (also currently dead code, also already tested)
- Clear `m.approvalBlockIdx`

### Change 4: Fix `findToolCallByID` to search sub-agent tool calls

In `[run_stream_convert.go](client-apps/cli/cmd/stigmer/root/run_stream_convert.go)`, extend `findToolCallByID` to accept the full `AgentExecution` (or sub-agent list) and fall back to searching `SubAgentExecution.ToolCalls` when the tool call is not found at the top level.

### Change 5: Enrich the approval footer

In `[view.go](client-apps/cli/pkg/executiontui/view.go)`, include the tool name in the footer hint so the user has a quick glance even without scrolling to the approval block:

```
[a] Approve (Write)  [s] Skip  [r] Reject  [q] Detach
```

### Change 6: Remove duplicate action keys from `renderApprovalPrompt`

The current `renderApprovalPrompt` includes inline `[a] Approve [s] Skip [r] Reject`. Since these are already in the footer, remove them from the viewport block to avoid redundancy. The viewport block becomes pure context; the footer remains the action area.

## Target UX

**Before** (current -- context-free):

```
  Agent: Now I'll create the skill directory and all its files:
  Agent is working...
  [a] Approve  [s] Skip  [r] Reject  [q] Detach
```

**After** (proposed -- contextual):

```
  Agent: Now I'll create the skill directory and all its files:
  
  🔀 general-purpose -- Create skill directory structure

  📝 Write: seedpack/skills/agent-creator/README.md (1.2 kB, 28 lines) ⏸

  ⏸  APPROVAL REQUIRED
     Sub-agent: general-purpose
     Write file to disk: seedpack/skills/agent-creator/README.md
     path: seedpack/skills/agent-creator/README.md
     contents: (1.2 kB, 28 lines)

  [a] Approve (Write)  [s] Skip  [r] Reject  [q] Detach
```

## Files Changed (8 files, all in CLI)


| File                                     | Change                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| `pkg/executiontui/events.go`             | Add `FromSubAgent`, `SubAgentName` to `ApprovalNeededEvent` |
| `pkg/executiontui/model.go`              | Add `approvalBlockIdx int` field                            |
| `pkg/executiontui/handle_events.go`      | Create approval block from `renderApprovalPrompt`           |
| `pkg/executiontui/approval.go`           | Replace approval block with confirmation on response        |
| `pkg/executiontui/render_approval.go`    | Add sub-agent context, remove inline action keys            |
| `pkg/executiontui/view.go`               | Show tool name in approval footer                           |
| `cmd/stigmer/root/run_stream_events.go`  | Thread sub-agent fields through `extractApprovalInfo`       |
| `cmd/stigmer/root/run_stream_convert.go` | Extend `findToolCallByID` to search sub-agent tool calls    |


## No proto changes required

The `PendingApproval` proto already has all needed fields (`from_sub_agent`, `sub_agent_name`, `tool_name`, `args_preview`, `message`). This is purely a CLI-side wiring fix.