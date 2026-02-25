# Replace Sub-Agent Nesting Prefix with Context Separators

**Date**: February 26, 2026

## Summary

Replaced the per-block `↳` indent prefix on sub-agent output with labeled context separator lines (e.g., `── researcher ──`) that appear once when the active agent changes. This gives users clear, unobtrusive attribution of which sub-agent owns a group of actions without cluttering every line of output.

## Problem Statement

The TUI displayed a `↳` prefix on every line originating from a sub-agent execution. This prefix appeared even when only a single sub-agent was active (since the `skill-creator` agent internally spawns sub-agents), and it never identified *which* sub-agent produced the output.

### Pain Points

- The `↳` symbol conveyed nesting but not identity — users had no way to tell which sub-agent was responsible for a group of tool calls
- It appeared as visual noise in the most common case (single-sub-agent executions like `draft agent`)
- The `hasMultipleSubAgents` conditional logic added complexity: it suppressed the prefix for single-sub-agent runs but still confused users when it did appear
- The per-line indent pushed all sub-agent content rightward, reducing usable terminal width

## Solution

Replace the per-block indent with a single context separator line inserted when the active agent context changes. The separator uses the human-readable sub-agent name from the backend's `SubAgentExecution.name` field (e.g., "researcher", "code_editor"), rendered as a dim horizontal rule:

```
  📖 Read: bin/skills/skill-creator/SKILL.md (18 KB, 258 lines) ▶
── researcher ──
  💭 Thinking (141 chars, 1 line, 577ms) ▶
  📖 Read: inputs/agent/docs/README.md (3.2 KB, 53 lines) ▶
```

Returning to the main agent does not produce a separator — the absence of a label is the signal.

## Implementation Details

The change spans 5 layers of the CLI architecture:

**Layer 1 — Event and data model:**
- Added `SubAgentStartedEvent` (with `ID` and `Name` fields) to `events.go` to propagate sub-agent names as a one-time event
- Added `subAgentName` field to `contentBlock` for self-contained rendering
- Added `subAgentNames map[string]string` to the TUI `Model` for name lookup

**Layer 2 — Bridge (stream → TUI):**
- Modified `emitSubAgentEvents` in `run_stream_subagent.go` to emit `SubAgentStartedEvent` when a new sub-agent is first detected, before any tool/message events

**Layer 3 — Event handling:**
- Added handler for `SubAgentStartedEvent` in `handleExecutionEvent` to populate the name map
- Stamped `subAgentName` on every `contentBlock` alongside `subAgentID` across all event types (AI messages, stream start/end, tool stream delta, tool badge updates, finalize)

**Layer 4 — Rendering:**
- Deleted `hasMultipleSubAgents`, `indentSubAgentBlock`, `subAgentIndent`, and `subAgentContinuation`
- Simplified `renderedBlockText` by removing the `nestSubAgents` parameter
- Added `renderSubAgentSeparator(name)` and `needsSubAgentSeparator(blocks, idx)` to detect context switches and render labeled separators
- Updated `rebuildViewportContent` to inject separator parts on agent context changes
- Updated `blockStartLine` in `scroll.go` to account for separator line height

**Layer 5 — Tests:**
- Replaced 7 old nesting tests with 9 new tests covering separator rendering, context switch detection, and viewport integration

## Benefits

- **Clear attribution**: Users now see which sub-agent is active via a human-readable label
- **Reduced visual noise**: One separator line per context switch vs. a prefix on every single line
- **Full terminal width**: Sub-agent output is no longer indented, reclaiming 4 characters of horizontal space
- **Simpler code**: Removed conditional `hasMultipleSubAgents` logic and per-line indent functions
- **Future-proof**: The `subAgentNames` map and `SubAgentStartedEvent` provide clean extension points for future features (filtering by sub-agent, sub-agent timelines, etc.)

## Impact

- **End users**: Cleaner, more informative TUI output during agent executions that involve sub-agents
- **Developers**: Simpler rendering pipeline with fewer moving parts; the separator logic is localized to two small functions
- **Files changed**: 9 files across `executiontui` package, `run_stream_subagent` bridge, and their tests

## Related Work

- [CLI Sub-Agent Streaming and Nesting UX](2026-02-25-020751-fix-cli-sub-agent-streaming-and-nesting-ux.md) — original introduction of the `↳` nesting prefix
- [Sub-Agent Visibility in TUI](2026-02-24-175608-sub-agent-visibility-in-tui.md) — initial sub-agent event propagation to the TUI

---

**Status**: ✅ Production Ready
