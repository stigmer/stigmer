# Fix Sub-Agent Subject Displaying Full Task Prompt

**Date**: March 11, 2026

## Summary

Fixed a critical UX issue where the sub-agent header in the CLI TUI displayed the entire multi-line task prompt instead of a concise title. The root cause was a mismatch between how the status_builder interpreted the deepagents `task` tool's `description` argument and what it actually contains — the full task prompt, not a short label.

## Problem Statement

When sub-agents were launched during agent execution, the CLI TUI rendered the full task prompt (potentially dozens of lines of instructions) as the sub-agent header label. Users expected to see a concise title like "Scan workflow dependencies" but instead saw the entire delegation prompt including file paths, numbered instructions, and detailed task descriptions.

### Pain Points

- Sub-agent header consumed the entire visible terminal area with prompt text
- Impossible to quickly scan which sub-agents were active and what they were doing
- The `(N tools)` count and spinner activity were pushed far below the visible area
- Regression from when `_generate_sub_agent_subject()` was removed in the streamline project

## Solution

Three-layer fix across backend and CLI:

1. **Backend**: Restored economy-tier LLM subject generation and fixed the field mapping to correctly handle deepagents' `task` tool parameter structure
2. **CLI**: Added defensive truncation (first line + 80 char limit) to all sub-agent subject display points
3. **Design decision**: Updated DD-02 to document the corrected understanding

## Implementation Details

### Root Cause Discovery

The deepagents `task` tool has only two user-facing parameters:
- `description` — the **full task prompt** (becomes the `HumanMessage` to the sub-agent)
- `subagent_type` — which agent to delegate to

There is no separate `prompt`, `input`, or `task` parameter. DD-02 incorrectly assumed `description` was "a concise label (3-10 words)".

### Backend (`status_builder.py`)

- **Restored `_generate_sub_agent_subject()`**: Economy-tier LLM (claude-haiku-4.5/gpt-4o-mini) generates a 3-7 word title from the full prompt, capped at 50 chars
- **Fixed field mapping**: `sub_agent_input` now reads from `description` first (deepagents' actual key), with fallbacks to `input`/`task`/`prompt` for compatibility
- **`_handle_sub_agent_start` is `async` again**: Required for the LLM subject generation call

### CLI (Go)

- **`renderSubAgentLine()`**: Added `toolrender.Truncate(toolrender.FirstLine(label), 80)` for the live spinner view
- **`renderSubAgentStarted()`**: Truncates before sending to Bubbletea model or printing inline
- **`renderSubAgentBlockItem()`**: Truncates in collapsed/expanded history views
- **New `FirstLine()` in `toolrender/format.go`**: Extracts first line from multi-line strings

### Tests

- Updated 5 Python test methods for the new field mapping
- Added `autouse` fixtures to 4 test classes to patch `_generate_sub_agent_subject` (returns `""` in test env)
- All 38 existing Go sub-agent tests pass without modification

## Benefits

- Sub-agent headers are now concise and scannable (e.g., "Scan workflow dependencies")
- Terminal space is used efficiently — activity spinner and tool count are immediately visible
- Defense-in-depth: even if the LLM subject generation fails, the CLI truncates gracefully
- Full task prompt is still available in `input` field (shown in expanded history view)

## Impact

- **CLI users**: Immediately see meaningful sub-agent labels instead of prompt walls
- **Backend**: One additional economy-tier LLM call per sub-agent spawn (negligible cost)
- **Compatibility**: Fallback chain (`description` → `input` → `task` → `prompt`) preserves backward compatibility

## Related Work

- Project: `20260309.01.sub-agent-execution-streamline` (DD-02 superseded)
- Project: `20260303.02.cli-tui-ux-hardening` (complementary UX fixes)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
