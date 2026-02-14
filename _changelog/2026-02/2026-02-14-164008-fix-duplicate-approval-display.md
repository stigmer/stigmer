# Fix Duplicate Information in CLI Approval Box

**Date**: February 14, 2026

## Summary

Fixed redundant display of tool arguments in the CLI approval box. Previously, when agents requested approval for tool calls, the same command information was shown twice—once in the "Message" field and again in the "Arguments" field, creating visual noise and confusion. The fix ensures arguments are only shown when a human-readable message isn't available, making approvals cleaner and easier to understand.

## Problem Statement

When the CLI displayed approval requests for tool calls like `execute`, users saw the same command information duplicated in the approval box:

```
╭─ APPROVAL REQUIRED ──────────────────╮
│                                       │
│  Tool:  execute                       │
│                                       │
│  Message: Execute command: cd /wo...  │  ← First display
│                                       │
│  Arguments:                           │
│  command: cd /wo...                   │  ← Duplicate display
│                                       │
╰───────────────────────────────────────╯
```

This happened because the backend sends both a templated human-readable message (`"Execute command: {{args.command}}"`) and the raw JSON arguments, and the CLI was showing both unconditionally.

### Pain Points

- Redundant information made the approval box unnecessarily long
- Users had to read the same command twice to understand what needed approval
- The "execute" tool wasn't recognized by the approval formatter, falling back to generic display
- Visual clutter reduced the effectiveness of the approval UI

## Solution

Implemented two complementary fixes:

1. **Added "execute" to approval formatter's tool categories** — The approval formatter now recognizes "execute" as a command tool (matching what the inline tool renderer already knew)

2. **Conditional Arguments display** — Arguments are now only shown when the Message field is empty. Since Message is specifically designed as a human-readable approval prompt that includes key arguments, showing both is redundant.

## Implementation Details

**File 1: `client-apps/cli/pkg/approval/formatter.go`**
- Added `"execute": {primaryField: "command", label: "Command"}` to the `toolCategories` map
- This aligns with the existing `toolDisplayMap` in `toolrender/render.go`

**File 2: `client-apps/cli/cmd/stigmer/root/run_display_approval.go`**
- Changed `buildApprovalContent()` to conditionally show Arguments section:
  ```go
  if pa.Message == "" && pa.ArgsPreview != "" {
      // Only show arguments when no human-readable message exists
      formatted := approval.FormatArgs(pa.ToolName, pa.ArgsPreview)
      // ...
  }
  ```

The logic ensures that:
- When `Message` is present (the common case), Arguments are hidden since Message already includes the key information
- When `Message` is empty (fallback path, e.g., synthetic approvals from defense-in-depth), Arguments still display
- The approval formatter now properly handles "execute" tool calls with command-specific formatting

## Benefits

- **Cleaner approval UI** — Users see approval information exactly once
- **Faster comprehension** — No need to read duplicate information
- **Consistent tool handling** — "execute" tool now formatted consistently between inline display and approval box
- **Preserved fallback** — Arguments still show when Message isn't available (defense-in-depth)

## Impact

**Who's affected**:
- CLI users who approve tool calls during agent execution
- Most visible for `execute`, `shell`, and file operation tools

**After the fix**, approval boxes look like:

```
╭─ APPROVAL REQUIRED ──────────────────╮
│                                       │
│  Tool:  execute                       │
│                                       │
│  Message: Execute command: cd /wo...  │
│                                       │
│  Waiting for: just now                │
│                                       │
╰───────────────────────────────────────╯
```

Clear, concise, no duplication.

## Related Work

- Approval UX improvements for CLI agent execution flow
- Part of the broader effort to refine interactive CLI experiences
- Complements the recent work on streaming AI messages and tool call rendering

---

**Status**: ✅ Production Ready  
**Timeline**: Single session fix
