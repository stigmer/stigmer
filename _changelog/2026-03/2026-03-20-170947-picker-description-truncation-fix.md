# Fix Description Truncation Across All Picker Components

**Date**: March 20, 2026

## Summary

All picker and selector components in `@stigmer/react` truncated item descriptions to a single line, making it impossible for users to evaluate options by reading descriptions. This change introduces an "expand on interaction" pattern: descriptions now show two lines by default and expand to full text on hover or keyboard focus -- all via pure CSS with zero additional JS.

## Problem Statement

Every picker component (AgentPicker, McpServerPicker, SkillPicker, McpToolSelector, McpServerConfigPanel, ResourceListView) used `line-clamp-1` or `truncate`, cutting descriptions to fragments that provided insufficient context for informed selection decisions.

### Pain Points

- MCP tool descriptions like "Create or update a Stigmer agent (idempotent)..." were truncated mid-word, losing critical differentiating context
- Agent and skill descriptions were reduced to a few words, forcing trial-and-error selection
- No way to see full descriptions without selecting the item first
- The problem existed identically across agents, MCP servers, skills, and tools
- ContextChip labels in the composer toolbar were truncated with no tooltip

## Solution

A layered "expand on interaction" pattern using Tailwind's `group` + modifier utilities:

- **Layer 1 -- Better default**: `line-clamp-1` replaced with `line-clamp-2` across all picker descriptions, showing a meaningful phrase or full sentence
- **Layer 2 -- Expand on interaction**: Descriptions expand to full text on hover (`group-hover:line-clamp-none`) and keyboard focus (conditional className when `idx === focusIndex`)
- **Layer 3 -- ContextChips**: Added `title` attribute for native browser tooltip on truncated chip labels

## Implementation Details

Seven locations modified, all in `@stigmer/react` (SDK layer):

| Component | File | Change |
|-----------|------|--------|
| AgentPicker | `agent/AgentPicker.tsx` | `group` on button, conditional `line-clamp-2`/unclamped |
| McpServerPicker | `mcp-server/McpServerPicker.tsx` | Same pattern |
| SkillPicker | `skill/SkillPicker.tsx` | Same pattern |
| McpToolSelector | `mcp-server/McpToolSelector.tsx` | `group` on wrapper div, `group-hover:` + `group-focus-within:` |
| McpServerConfigPanel | `mcp-server/McpServerConfigPanel.tsx` | Static `line-clamp-2` (header, no hover) |
| ResourceListView | `library/ResourceListView.tsx` | `group` on interactive row, `line-clamp-2` with hover expand |
| ContextChip | `composer/SessionComposer.tsx` | `title={label}` attribute |

Key technical decisions:
- Used `idx !== focusIndex` conditional for keyboard-focused rows rather than `group-aria-selected:` to avoid Tailwind v4 modifier compatibility uncertainty
- Used `group-focus-within:line-clamp-none` for McpToolSelector where focus flows through checkbox inputs
- Changed ResourceListView flex alignment from `items-center` to `items-start` to support multi-line description rendering
- Added `cn()` import from `@stigmer/theme` to AgentPicker and SkillPicker (previously used `.join(" ")`)

## Benefits

- Users can now read meaningful descriptions when selecting agents, MCP servers, skills, and tools
- Keyboard navigation shows full descriptions with accessibility parity to mouse hover
- Zero JS added -- pure CSS approach keeps bundle size unchanged
- Pattern works identically when components are embedded in third-party dashboards
- Row height increase is modest (~11px per row), losing only 2-3 visible items in a popover

## Impact

- **Direct users**: Better informed selection decisions in the SessionComposer and Library views
- **Platform builders**: Embeddable picker components now provide adequate description context out of the box
- **Accessibility**: Keyboard-focused items show full descriptions, matching hover behavior

## Related Work

- Part of the ongoing picker component improvements in `@stigmer/react`
- Follows the MCP server setup flow project (`20260320.02`) which introduced McpToolSelector and McpServerConfigPanel

---

**Status**: Production Ready
**Timeline**: Single session
