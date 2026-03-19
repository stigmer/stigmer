# SessionComposer AgentPicker Integration

**Date**: March 19, 2026

## Summary

Wired the AgentPicker component into the SessionComposer toolbar as the first context trigger, enabling agent selection within the unified message composer. This completes the SDK-side integration for agent selection in Phase 1 of the agent-picker-personal-env project.

## Problem Statement

The SessionComposer supported workspace, MCP server, and skill context pickers, but had no way to select an agent. Users needed a way to choose which agent to use for a session directly from the composer toolbar.

### Pain Points

- No agent selection UI in the session composer
- Agent selection had to happen outside the composer flow
- The composer's context model was incomplete — it supported tools (MCP, skills) and workspace but not the agent itself

## Solution

Extended the SessionComposer with two new controlled props (`agentRef`, `onAgentRefChange`) following the exact pattern established by MCP and skill pickers. The AgentPicker renders inside a ContextPopover as the first toolbar item, reflecting that agent selection has the highest impact on session behavior.

## Implementation Details

Single file modified: `sdk/react/src/composer/SessionComposer.tsx` (+83 lines net).

- **Props**: `agentRef?: ResourceRef | null` and `onAgentRefChange?: (ref: ResourceRef | null) => void` added to `SessionComposerProps`
- **Visibility**: `showAgent = onAgentRefChange != null && org != null` — agent trigger only appears when the consumer opts in, consistent with MCP/skill pattern
- **Toolbar**: AgentPicker in ContextPopover as first trigger (before Workspace, MCP, Skills) per Design Decision 003
- **Chips**: Extended `ChipItem["type"]` with `"agent"` and `CHIP_TYPE_LABELS` with `agent: "Agent"`. Agent chip renders first in the chip row
- **Icon**: 14x14 AgentIcon (bot/robot metaphor) matching the toolbar icon style
- **JSDoc**: Component description and `@example` block updated to include agent props

## Benefits

- Platform builders can now offer agent selection in the composer with two props: `agentRef` + `onAgentRefChange`
- Zero new components or hooks required — reuses the existing AgentPicker from T01.2
- No changes to ContextPopover or ContextChip — the existing abstractions accommodated the new picker type cleanly
- Fully opt-in: existing consumers are unaffected (agent trigger only appears when `onAgentRefChange` is provided)

## Impact

- **SDK consumers**: `SessionComposer` now supports agent selection alongside workspace, MCP, and skill context
- **Console**: SessionLauncher will wire `agentRef` state in the follow-up task (T01.11)
- **Backward compatible**: No breaking changes — the new props are optional

## Related Work

- T01.1–T01.8: Building-block hooks and barrel exports (completed in sessions 1–8)
- T01.10: `useCreateSession` wiring (next task — adds `agentRef` to session creation)
- T01.11: Console integration (wire `agentRef` in SessionLauncher)
- Design Decision 003: AgentPicker as single-select, first toolbar position

---

**Status**: ✅ Production Ready
**Timeline**: Session 9 of the agent-picker-personal-env project
