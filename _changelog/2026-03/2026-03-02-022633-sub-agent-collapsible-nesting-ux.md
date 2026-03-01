# Sub-Agent Collapsible Nesting UX

**Date**: March 2, 2026

## Summary

Transformed sub-agent execution display from a flat, undifferentiated block list into collapsible sections with visual nesting. Sub-agents now start collapsed showing a dynamic summary (tool count + status badge); expanding reveals indented child blocks with a persistent left gutter for scroll context. This eliminates the core UX gap where users could not distinguish sub-agent tool blocks from main agent blocks after scrolling past the header.

## Problem Statement

The TUI rendered all blocks -- main agent tools, sub-agent tools, AI messages -- at the same indentation level. Once a user scrolled past the sub-agent header, there was no visual signal that a tool block belonged to a sub-agent vs. the main agent.

### Pain Points

- **No scroll context**: After scrolling past the sub-agent header, every tool block looked identical regardless of which agent owned it
- **Screen overwhelm**: Sub-agent content (often 5-15 tool calls) expanded inline, burying the main agent's output
- **Static header**: The sub-agent header showed the type and description but no live activity summary -- users had to expand and count blocks manually to gauge progress
- **No completion signal**: There was no event or visual indicator when a sub-agent finished its work

## Solution

Keep the flat `[]contentBlock` list (avoiding a risky rewrite of scroll, focus, and line-count math) but add two capabilities:

1. **Group visibility control**: The `blockSubAgent` header's expand/collapse toggles a `hidden` field on all child blocks with matching `subAgentID`, rather than showing/hiding the task prompt
2. **Visual nesting gutter**: When expanded, all child blocks render with a `│` left border prefix so the user always knows they're inside a sub-agent context

## Implementation Details

### Bridge Layer (1 file)

- **`run_stream_subagent.go`**: Added `completed` field to `subAgentTracker` and `isTerminalSubAgentStatus()` helper. After processing tool and message events, detects when `SubAgentExecution.Status` transitions to `SUB_AGENT_COMPLETED` or `SUB_AGENT_FAILED` and emits `SubAgentCompletedEvent` with final tool count and status.

### TUI (8 files + 1 test file)

- **`events.go`**: Added `SubAgentCompletedEvent` with `ID`, `Status`, `ToolCount`, `Output` fields
- **`blocks.go`**: Added `hidden bool` field to `contentBlock`. Changed `newSubAgentBlock` to always be expandable (controls child visibility) and start collapsed. Signature changed from `(name, description, input string)` to `(name, description string, toolCount int, status string)`
- **`model.go`**: Extended `subAgentInfo` with `ToolCount` and `Status` fields. Added `subAgentBlockIdx map[string]int` to track header block indices for in-place updates
- **`render_blocks.go`**: Added `indentForSubAgent()` with `│` gutter prefix applied at render time. Updated `renderedBlockText` to return `""` for hidden blocks and apply indentation for sub-agent children. Rewrote `renderSubAgentHeader` to show dynamic stats (`(N tools, status)` badge). Removed the old prompt-expansion rendering
- **`handle_events.go`**: `SubAgentStartedEvent` tracks header index and sets initial status. AI and tool events set `hidden` based on sub-agent collapsed state. New `SubAgentCompletedEvent` handler updates meta and header. `updateToolBadge` increments tool count on new block creation. Added `isSubAgentCollapsed()` and `updateSubAgentHeader()` helpers
- **`focus.go`**: Navigation (`focusNextExpandable`, `focusPrevExpandable`) skips hidden blocks. `toggleFocusedBlock` calls `toggleSubAgentChildren` for `blockSubAgent` headers. `hasExpandableBlocks` skips hidden blocks
- **`scroll.go`**: Inherently correct via `renderedBlockText` returning `""` for hidden blocks; updated documentation
- **`followup.go`**: Resets `subAgentMeta` and `subAgentBlockIdx` when a follow-up execution starts
- **`render_blocks_test.go`**: Updated all test call sites for the new `newSubAgentBlock` signature. Replaced old expandable/non-expandable tests with tests for always-expandable behavior, tool count display, and starts-collapsed default

### Target UX

**Collapsed (default):**
```
  🔀 general-purpose ─ Explore CLI sub-agent rendering  (6 tools, done) ▶
```

**Expanded:**
```
  🔀 general-purpose ─ Explore CLI sub-agent rendering  (6 tools, done) ▼
  │
  │  🤖 Agent: Let me read the relevant files...
  │
  │  📖 Read: workflows.md (810 chars, 28 lines) ▶
  │
  │  📖 Read: what-is-skill.md (16 KB, 437 lines) ▶
  │
  │  🤖 Agent: Now let me check the proto schemas...
```

## Benefits

- **Immediate clarity**: Collapsed header shows tool count and status at a glance -- no need to expand and count manually
- **Scroll context**: The `│` gutter on every child block line provides persistent visual nesting even after scrolling 100+ lines past the header
- **Reduced noise**: Sub-agent output is collapsed by default, keeping the main agent's flow front and center
- **No flash-before-hide**: New blocks for collapsed sub-agents arrive hidden immediately, preventing visual flicker
- **Backward compatible**: Orphaned sub-agent blocks (missing header) still work via the existing fallback separator

## Impact

- **CLI users**: Dramatically cleaner execution output when the main agent delegates to sub-agents -- the common case in complex tasks
- **No proto changes**: Uses existing `SubAgentExecution.status` and `tool_calls` length -- no `buf generate` needed
- **10 files changed** (1 bridge layer Go, 8 TUI Go, 1 test file), 302 insertions, 121 deletions
- **All 113 existing tests pass** with the updated code

## Related Work

- Builds on the sub-agent header block UX from March 1 (informative expandable headers)
- Uses the same in-place update pattern as todo blocks for live header refresh
- Uses the same expand/collapse interaction pattern (Tab/Enter) as tool blocks and todo blocks

---

**Status**: ✅ Production Ready
