# Sub-Agent Visibility in TUI

**Date**: February 24, 2026

## Summary

Added full visibility of sub-agent activity in the CLI Terminal User Interface (TUI). Previously, when the main agent delegated work to a sub-agent via the "task" tool, the TUI showed no indication of what the sub-agent was doing — its tool calls, reasoning, and streaming output were completely invisible. Users saw the main agent appear stuck with no activity. This change surfaces sub-agent tool calls, messages, and streaming content as visually indented blocks nested under the parent task tool block.

## Problem Statement

The backend `StatusBuilder` correctly tracked sub-agent executions in the `SubAgentExecutions` field of `AgentExecutionStatus`, but the CLI TUI never consumed this data. When the main agent delegated work, the TUI displayed the "task" tool as a generic unknown tool (no entry in `toolDisplayMap`) and showed zero activity during the sub-agent's execution — no tool calls, no AI messages, no streaming content.

### Pain Points

- The TUI appeared frozen during sub-agent execution, causing users to assume the system was stuck
- Users manually paused executions thinking tokens were being wasted, when the sub-agent was actively working
- No way to observe sub-agent reasoning, tool usage, or progress from the CLI
- The "task" tool rendered as an unknown tool with no icon or label

## Solution

A layered approach that integrates sub-agent data into the existing TUI block system with minimal new concepts:

1. **Event layer**: Added `SubAgentID` field to existing tool and message event types rather than creating separate sub-agent event types
2. **Block layer**: Added `subAgentID` field to `contentBlock` for rendering-time indent detection
3. **Rendering layer**: Added `indentSubAgentBlock()` that prefixes blocks with `↳` and aligns continuation lines
4. **Event emission**: Created a dedicated `subAgentTracker` that mirrors the top-level tool call diff logic for each sub-agent

## Implementation Details

### Files Changed

**Tool Display Registration** (`client-apps/cli/pkg/toolrender/render.go`)
- Added `"task"` to `toolDisplayMap` with icon `🔀`, label "Task", primaryField "description"

**Event Types** (`client-apps/cli/pkg/executiontui/events.go`)
- Added `SubAgentID string` to `AIMessageEvent`, `ToolRunningEvent`, `ToolCompletedEvent`, `ToolWaitingApprovalEvent`, `ToolStreamDeltaEvent`

**Block Model** (`client-apps/cli/pkg/executiontui/blocks.go`)
- Added `subAgentID string` to `contentBlock` — triggers indent rendering when non-empty

**Rendering** (`client-apps/cli/pkg/executiontui/render_blocks.go`)
- Added `indentSubAgentBlock()` with `↳` prefix on first line and aligned whitespace on continuation lines
- Applied in `renderedBlockText()` after expand/collapse decoration

**Event Handling** (`client-apps/cli/pkg/executiontui/handle_events.go`, `approval.go`)
- Updated `updateToolBadge()` signature to accept and propagate `subAgentID`
- Updated all call sites including `finalizeRunningTools()` and approval handling

**Event Emission** (`client-apps/cli/cmd/stigmer/root/run_stream_subagent.go` — new file)
- `subAgentTracker` struct: per-sub-agent message cursor and tool call state maps
- `emitSubAgentEvents()`: iterates sub-agents and delegates to per-sub-agent processing
- `emitSubAgentToolCallEvents()`: mirrors top-level tool call diff logic with `SubAgentID` set
- `emitSubAgentMessageEvents()`: emits AI messages (skipping streaming-in-progress and tool result messages already handled by tool state tracker)

**Stream Integration** (`client-apps/cli/cmd/stigmer/root/run_stream_events.go`)
- Added `subAgentTrackers` map and `emitSubAgentEvents()` call in the main stream loop
- Added `sub_agents` count to debug logging

### Visual Output

```
🔀 Task: Explore codebase ⏳
  ↳ 🤖 Agent: I'll read the relevant files...
  ↳ 📖 Read: src/main.go ✓
  ↳ 📝 Write: src/fix.go ⏳
  ↳      │ package main
  ↳      │ func fix() {▍
🔀 Task: Explore codebase ✓
```

## Benefits

- Users can see real-time sub-agent activity instead of a frozen TUI
- Sub-agent tool calls stream content live with the same fidelity as top-level tools
- The "task" tool now renders with a proper icon (`🔀`) and label ("Task")
- Visual nesting (`↳` prefix) clearly communicates the parent-child relationship
- No new block types or event types — reuses the existing infrastructure with a single discriminator field

## Impact

- **CLI users**: Immediate visibility into sub-agent work that was previously invisible
- **Debugging**: Sub-agent count now appears in stream debug logs
- **Architecture**: The `SubAgentID` pattern is extensible — future nested sub-agents can be supported by propagating the field through additional levels

## Related Work

- [Stream Tool Input During Argument Generation](2026-02-24-150647-stream-tool-input-during-argument-generation.md) — the prior change that revealed the sub-agent visibility gap
- [Fix Streaming UX and Protobuf Copy Semantics](2026-02-24-043603-fix-streaming-ux-and-protobuf-copy-semantics.md) — introduced early tool call creation and identified the "invisible sub-agents" problem

---

**Status**: ✅ Production Ready
