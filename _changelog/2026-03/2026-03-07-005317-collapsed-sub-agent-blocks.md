# Collapsed Sub-agent Blocks

**Date**: March 7, 2026

## Summary

Sub-agent executions (Task tool calls) now render as a single collapsed summary line by default, hiding all internal tool calls, AI messages, and read groups. A live running counter updates in the Bubbletea View() while the sub-agent executes, and the final committed block expands to show full gutter-wrapped details when the user presses Ctrl+O.

## Problem Statement

When a sub-agent executed, every internal event — tool completions, AI reasoning messages, read groups, and approval results — was rendered individually to the terminal scrollback with gutter wrapping. This produced a wall of verbose output that obscured the main agent's narrative flow and made it difficult for users to follow what the agent was actually doing.

### Pain Points

- The full input prompt text passed to the sub-agent was shown, which was often several paragraphs long and useless to the user
- Every internal tool call (reads, writes, shell commands) rendered individually, flooding the terminal
- There was no way to distinguish "important" main-agent output from intermediate sub-agent reasoning
- No progressive feedback during sub-agent execution — users couldn't tell how much work was being done

## Solution

Implemented Approach C from the design discussion: a two-phase aggregate model using `subAgentBlock`. During execution, all internal events are buffered in the block's `children` list while a live summary line shows progress in the Bubbletea View(). On completion, the entire block is committed to history as a single `kindSubAgentBlock` item that renders collapsed (one summary line) or expanded (full gutter-wrapped children) based on the `expandMode` toggle (Ctrl+O).

## Implementation Details

### New types
- `subAgentBlock` struct: aggregates `id`, `name`, `subject`, `status`, `children`, `toolCount`, `output`
- `kindSubAgentBlock` committed kind: replaces the old `kindSubAgentStart` and `kindSubAgentComplete`
- `saBlock` field on `committedItem` for block rendering

### Event routing
- `handleEvent` routes all `ToolCompletedEvent`, `AIMessageEvent`, and `AIStreamEndEvent` with `SubAgentID` to the active block's children instead of scrollback
- `flushPendingReads` routes grouped reads to the block when the sub-agent is active
- `printCollapsedResult` and `recordApproval` route approval results to the block
- `completeStreamingTool` routes streaming completions to the block

### Bubbletea integration
- Three new messages: `subAgentShowMsg`, `subAgentUpdateMsg`, `subAgentHideMsg`
- Live running summary line: `"● Task: subject … (N tools)"` in `renderTransientContent`
- Priority ordering: approval > streaming > AI stream > sub-agent > spinner

### Non-TTY degradation
- Header line written on start via `statusf`
- Internal events buffered silently
- Summary line committed on completion

### Cleanup
- Removed `kindSubAgentStart`, `kindSubAgentComplete` from the committed kind enum
- Removed `Input` field from `SubAgentStartedEvent` (full prompt no longer sent to renderer)
- Fixed a subtle `activeStreamToolID == ""` guard bug exposed by the new routing

## Benefits

- **Dramatically cleaner output**: Sub-agent executions that previously produced 20-50+ lines now show as a single summary line
- **Progressive feedback**: Live tool count updates during execution so users know work is happening
- **Full detail on demand**: Ctrl+O expands to show every internal event with gutter wrapping
- **Approval break-through**: Approval prompts still appear naturally, pausing the collapsed view
- **History fidelity**: All internal events are preserved in the block for re-commit and session replay

## Impact

- All CLI users see collapsed sub-agent blocks by default
- Ctrl+O toggle works across the entire conversation history including sub-agent blocks
- Non-TTY/CI mode gets header + summary without live updates
- JSON output mode updated (removed `input` field from `sub_agent_started` events)

## Files Changed

| File | Changes |
|------|---------|
| `run_stream_inline_types.go` | Added `subAgentBlock` struct and `activeSubAgents` map |
| `run_stream_inline_history.go` | Added `kindSubAgentBlock`, `renderSubAgentBlockItem`, removed old kinds |
| `run_stream_inline_messages.go` | Added sub-agent show/update/hide messages |
| `run_stream_inline_bubbletea.go` | Added live summary handlers and View() rendering |
| `run_stream_inline.go` | Updated event routing, fixed `activeStreamToolID` guard |
| `run_stream_inline_render.go` | Rewrote sub-agent start/complete, added block helpers |
| `run_stream_inline_approval_display.go` | Route approval results to block |
| `run_stream_inline_streaming.go` | Route streaming completions to block |
| `run_stream_subagent.go` | Removed `Input` from event emission |
| `run_stream_json.go` | Removed `input` from JSON output |
| `events.go` | Removed `Input` field from `SubAgentStartedEvent` |
| `run_stream_inline_history_test.go` | Updated existing tests, added 11 new tests |
| `run_stream_inline_test.go` | Added `TestInlineRenderer_SubAgentToolsCollapsed` |

## Related Work

- [Sub-agent Collapsible Nesting UX](2026-03-02-022633-sub-agent-collapsible-nesting-ux.md) — earlier exploratory work on sub-agent display
- [Sub-agent Subject Generation](2026-03-03-020614-sub-agent-subject-generation-and-tui-redesign.md) — server-side subject generation that provides the display label
- [Ctrl+O Keybinding](2026-03-05-075631-ctrl-o-keybinding-full-bubbletea-stdin-ownership.md) — the expand/collapse toggle this feature leverages

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
