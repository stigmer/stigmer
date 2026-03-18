# Tool Call UX Overhaul: Type-Aware Rendering and Progressive Disclosure

**Date**: March 18, 2026

## Summary

Overhauled the tool call rendering, approval UX, and progressive disclosure in the execution message thread. Tool calls now render with category-specific visual treatments (terminal-style for shell commands, file path emphasis for file tools, etc.), approval cards are type-aware, noisy system messages have been removed, and the redundant "Completed" badge is suppressed from the thread.

## Problem Statement

The execution message thread treated all tool calls identically -- generic monospace tool name with raw JSON arguments -- regardless of whether the tool was a shell command, a file read, a search, or a delete operation. This created cognitive overhead for users monitoring agent executions, as they had to mentally parse JSON to understand what the agent was doing.

### Pain Points

- All tools rendered identically with generic monospace name + JSON args dump
- Approval cards showed raw tool names ("execute") without understanding the operation type
- "Approval received -- resuming execution" system messages cluttered the thread with no actionable value
- "Completed" phase badge in the thread duplicated the Details panel status
- Level 1 tool group summaries were overly generic ("3 tool calls" instead of "Ran 3 tools")

## Solution

Introduced a tool category registry (`tool-categories.ts`) that maps tool names to categories with display metadata, then updated all rendering layers (ToolCallGroup, ToolCallItem, ToolCallDetail, ApprovalCard) to leverage category-aware rendering with type-specific visual treatments.

## Implementation Details

### New Module: `sdk/react/src/execution/tool-categories.ts`

Pure data module (no React) that maps tool names to categories: `shell`, `read`, `write`, `edit`, `delete`, `search`, `list`, `think`, `sub-agent`, `unknown`. Mirrors the CLI's `toolDisplayMap` from `client-apps/cli/pkg/toolrender/render.go`. Exports `resolveToolCategory()`, `extractPrimaryArg()`, and `extractPrimaryArgFromPreview()` for platform builders.

### Level 1 -- ToolCallGroup (summary)

- Active-voice phrasing: "Ran 3 tools" (completed), "Running 2 tools" (in-progress), "Waiting for approval" (waiting)
- Single tool calls show category label + primary arg (e.g., "Shell: ls -la /tmp")

### Level 2 -- ToolCallItem (individual rows)

- Category-specific icons (terminal, file, folder, search, brain, bot, wrench)
- Category label replaces raw tool name
- Primary argument shown as truncated monospace subtitle
- Inline approval decision badges (Approved/Skipped/Rejected) when `approvalAction` is set

### Level 3 -- ToolCallDetail (detail panel)

- Shell tools: terminal-style dark block with `$ ` prompt prefix, themed via `--stgm-terminal-bg/fg/prompt` tokens
- File tools: file path shown prominently with content below
- Search/list tools: pattern header + results
- Think tools: muted italic thought block
- Unknown/MCP tools: generic args + result JSON fallback

### ApprovalCard

- Type-aware headers: "Execute command" with terminal icon for shell, "Delete file" with destructive border for delete
- Shell commands render in terminal-style preview block instead of raw JSON
- File tools show path prominently; search tools show pattern in code badge
- Falls back to generic JSON for unrecognized tools

### Backend: Agent Runner

- Removed "Approval received -- resuming execution" `MESSAGE_SYSTEM` injection
- Pre-stream IN_PROGRESS status update preserved for responsive UX
- Approval outcome rendered inline via ToolCall proto fields instead

### MessageThread

- Suppressed `EXECUTION_COMPLETED` phase badge (redundant with Details panel)
- Kept Failed/Cancelled/Terminated badges as actionable in-thread signals

## Benefits

- **Reduced cognitive load**: Users immediately see what kind of operation the agent is performing without parsing JSON
- **Cleaner thread**: No more noisy system messages or redundant badges
- **Theme-able terminal blocks**: Platform builders can customize terminal appearance via `--stgm-terminal-*` CSS custom properties
- **SDK-exported categorization**: Platform builders building custom UIs can use `resolveToolCategory()` and `extractPrimaryArg()` from `@stigmer/react`
- **CLI/web parity**: Same tool categorization logic across surfaces

## Impact

- **SDK (`@stigmer/react`)**: 7 files changed (1 new, 6 modified), new public exports added to barrel
- **Backend (agent-runner)**: 1 file changed (removed system message injection)
- **Backward-compatible**: `formatSummary` prop still works for custom summaries; unknown tools fall back to generic rendering
- **No proto changes**: Tool category remains a client-side concern

## Related Work

- CLI tool rendering: `client-apps/cli/pkg/toolrender/render.go` (established the categorization pattern)
- HITL approval flow: `_changelog/2026-02/2026-02-16-234006-fix-tool-approval-ux-unified-rendering.md`
- Approval card initial implementation: `_changelog/2026-03/2026-03-18-124620-fix-session-ui-ordering-layout-approvals.md`

---

**Status**: Production Ready
**Timeline**: Single session
