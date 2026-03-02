# Improve Execute/Shell Tool Approval UX

**Date**: March 2, 2026

## Summary

Redesigned the CLI approval experience for shell/execute tool calls to feel like a proper terminal command rather than a generic tool form. The approval prompt now renders commands with a `$` prefix in terminal style, eliminates redundant information (duplicate command text, raw "Tool: execute" labels), and hides the approval block after the user decides — letting the tool block's badge transition be the sole status indicator.

## Problem Statement

When an agent requested approval to run a shell command, the CLI displayed a cluttered, generic approval block that duplicated information and exposed internal implementation details to the user.

### Pain Points

- The backend `message` field echoed "Execute command: python3 ..." and the formatted `argsPreview` repeated "Command: python3 ..." — the user saw the same command twice
- "Tool: execute" was displayed as a raw internal label, providing no useful information beyond what the tool block header (`🖥  Execute: <command>`) already showed
- After approval, a separate "✅ Approved: execute" line persisted in the viewport as visual noise, redundant with the tool block's badge transition from ⏸ to ⏳ to ✓
- The footer hint `[a] Approve (execute)` showed the raw tool name instead of a human-readable label

## Solution

Introduced tool-category-aware approval rendering. Shell/execute commands are detected via the canonical `toolDisplayMap` in `toolrender` and routed to a terminal-style prompt. The approval block is treated as a transient interaction artifact that disappears after the user decides, rather than a permanent viewport record.

## Implementation Details

### New public API in `toolrender`

- `DisplayLabel(toolName)` — maps raw tool names to human-readable labels (e.g., `"execute"` → `"Execute"`, `"read_file"` → `"Read"`)
- `IsShellTool(toolName)` — reports whether a tool represents shell/command execution, derived from `toolDisplayMap` entries whose `primaryField` is `"command"`

### Shell-aware approval prompt (`render_approval.go`)

- `renderApprovalPrompt` now branches on `toolrender.IsShellTool(toolName)`
- Shell tools: renders the command with a `$ ` prefix in bold green, shows secondary args (timeout, working_directory) in dimmed style, suppresses the "Tool:" line and redundant "Execute command:" message
- Non-shell tools: unchanged generic format

### Hidden approval block post-decision (`approval.go`)

- After the user presses a/s/r, the approval block is marked `hidden = true` instead of being replaced with a "✅ Approved: execute" confirmation line
- The tool block's badge lifecycle (⏸ → ⏳ → ✓ / ⏭ / ✗) is the single source of truth

### Footer improvement (`view.go`)

- Approval footer now shows `[a] Approve (Execute)` via `toolrender.DisplayLabel()` instead of the raw `(execute)`

### Non-TUI path (`run_display_approval.go`)

- Panel-based approval display mirrors the same shell-aware formatting with `$ command` style

## Benefits

- Cleaner, less cluttered approval display — no duplicate command text or raw internal labels
- Terminal-style command rendering makes shell approvals feel native and recognizable
- Removing the post-approval confirmation line reduces viewport noise, especially during multi-tool executions
- Consistent use of display labels across footer hints, tool blocks, and approval prompts

## Impact

- **End users**: Significantly improved readability when agents request permission to run shell commands
- **All tool types**: The hidden-approval-block change benefits every tool approval, not just shell tools — the badge-based lifecycle is the universal pattern
- **Maintainability**: Shell detection is derived from the existing `toolDisplayMap` rather than duplicated — adding new shell tool names in one place propagates everywhere

## Related Work

- Previous fix for sub-agent approval surfacing (`fix(backend,cli): surface sub-agent tool approvals in CLI`)
- Execute tool protocol compliance fix (`fix(backend/libs): prevent deepagents middleware from stripping execute tool`)

---

**Status**: ✅ Production Ready
**Files Changed**: 8 (362 additions, 85 deletions)
