---
name: Fix duplicate approval display
overview: Fix the duplicate information shown in the CLI approval box where both "Message" and "Arguments" display the same command, and add the missing "execute" tool to the approval formatter's tool categories.
todos:
  - id: add-execute-to-categories
    content: Add "execute" to `toolCategories` map in `client-apps/cli/pkg/approval/formatter.go`
    status: completed
  - id: skip-redundant-args
    content: In `buildApprovalContent()` in `run_display_approval.go`, only show Arguments section when Message is empty
    status: completed
isProject: false
---

# Fix Duplicate Information in Approval Box

## Problem

When a tool call requires approval, the CLI approval box shows the **same command three times**:

1. **Inline stream line** (expected, not a problem):
  `🖥  Execute: cd /workspace && python .../init_skill.py agent-drafter --path .`
2. **Approval box "Message" section** (from `PendingApproval.Message`):
  `Message: Execute command: cd /workspace && python .../init_skill.py agent-drafter --path .`
3. **Approval box "Arguments" section** (from `PendingApproval.ArgsPreview`):
  `command: cd /workspace && python .../init_skill.py agent-drafter --path .`

Items 2 and 3 are redundant. The "Message" is a human-readable template rendering (`"Execute command: {{args.command}}"` from [approval_policy.py](backend/services/agent-runner/worker/activities/graphton/approval_policy.py) line 77), and "Arguments" is the raw JSON args formatted as key-value pairs. For single-arg tools like "execute", they show identical information.

## Root Cause

Two issues contribute:

**A. Missing "execute" in approval formatter's tool categories**

- [formatter.go](client-apps/cli/pkg/approval/formatter.go) `toolCategories` (line 28) does NOT include `"execute"` -- only `"shell"`, `"bash"`, `"execute_command"`, `"run_command"`, `"terminal"`
- Meanwhile, [render.go](client-apps/cli/pkg/toolrender/render.go) `toolDisplayMap` (line 66) DOES include `"execute"`
- This inconsistency means the approval formatter falls back to generic key-value display for the "execute" tool

**B. Unconditional display of both Message and Arguments**

- [run_display_approval.go](client-apps/cli/cmd/stigmer/root/run_display_approval.go) `buildApprovalContent()` (line 39) always shows both the `Message` section (line 51-54) and the `Arguments` section (line 57-63) when both are non-empty
- When the Message already includes the primary argument (as it does for execute, shell, file tools, etc.), the Arguments section is fully redundant

## Proposed Fix

### Fix 1: Add "execute" to `toolCategories` in formatter.go

Add `"execute"` entry to the `toolCategories` map in [formatter.go](client-apps/cli/pkg/approval/formatter.go) to match the `toolDisplayMap` in render.go:

```go
"execute":         {primaryField: "command", label: "Command"},
```

### Fix 2: Skip Arguments when Message already covers them

In `buildApprovalContent()` in [run_display_approval.go](client-apps/cli/cmd/stigmer/root/run_display_approval.go), only show the "Arguments" section when:

- `Message` is empty (no human-readable summary available), OR
- There are **additional** args beyond what the Message covers (for tools with multiple arguments)

The simplest correct approach: when `Message` is non-empty, skip the Arguments section entirely. The `Message` field is specifically designed as a human-readable approval prompt that includes the decision-relevant arguments (it's a template like `"Execute command: {{args.command}}"` or `"Edit file: {{args.path}}"`).

The change in `buildApprovalContent()`:

```go
// Tool arguments, formatted by tool type
// Only show arguments when there is no human-readable message
// (the message already includes the key arguments via its template)
if pa.Message == "" && pa.ArgsPreview != "" {
    formatted := approval.FormatArgs(pa.ToolName, pa.ArgsPreview)
    if formatted != "" {
        sections = append(sections, "")
        sections = append(sections, "Arguments:")
        sections = append(sections, formatted)
    }
}
```

### Result

After the fix, the approval box will look like:

```
+-- APPROVAL REQUIRED -------------------------------------------------+
|                                                                       |
|  Tool:  execute                                                       |
|                                                                       |
|  Message: Execute command: cd /workspace && python                     |
|  /bin/skills/.../init_skill.py agent-drafter --path .                 |
|                                                                       |
|  Waiting for: just now                                                |
|                                                                       |
+-----------------------------------------------------------------------+
```

Clean, no duplication. The Message provides all the context the user needs to make an approval decision.