# AgentPicker: Single-Select Agent Selection Component

**Date**: March 19, 2026

## Summary

Added the `AgentPicker` component to `@stigmer/react` — a single-select searchable picker for choosing an agent from the platform. This is the second building-block component (T01.2) in the agent-picker personal-env project, following the `useAgentSearch` data hook (T01.1). The picker is designed for both platform builders (standalone use) and direct Stigmer users (SessionComposer integration in T01.9).

## Problem Statement

The SessionComposer has pickers for MCP servers and skills, but no way to select an agent. Users need to choose which agent runs their session, and platform builders need a drop-in component for agent selection in their own UIs.

### Pain Points

- No agent selection UI exists in the SDK
- A session runs against exactly one agent, requiring single-select semantics — fundamentally different from the multi-select SkillPicker and McpServerPicker
- Platform builders need a reusable picker component they can embed without SessionComposer

## Solution

Built a self-contained `AgentPicker` component following the established picker visual pattern but with single-select semantics. The component renders picker content (search + results list) designed to be placed inside any container — the popover shell is the consumer's responsibility.

## Implementation Details

### New File
- `sdk/react/src/agent/AgentPicker.tsx` (~280 lines)

### Props API (Public Surface)
```typescript
interface AgentPickerProps {
  org: string;
  value: ResourceRef | null;
  onChange: (ref: ResourceRef | null) => void;
  onDisplayNameResolved?: (key: string, name: string) => void;
  disabled?: boolean;
  className?: string;
}
```

### Single-Select Behavior
- `value` is `ResourceRef | null` (not `ResourceRef[]`)
- Clicking a result replaces the current selection (no append)
- Deselect calls `onChange(null)` (no array filtering)
- Selected agent is excluded from results list (consistent with existing pickers)

### Self-Contained Architecture
Each picker (SkillPicker, McpServerPicker, AgentPicker) is independently implemented with its own private helpers (HighlightMatch, LoadingSkeleton, icon, XIcon). This was a deliberate architectural choice: single-select vs multi-select is a fundamental behavioral difference, and McpServerPicker will diverge further with per-tool selection. Self-contained files are easier to understand and evolve independently.

### Accessibility
- `role="combobox"` on search input with `aria-expanded`, `aria-controls`, `aria-activedescendant`
- `role="listbox"` on results with `role="option"` on items
- Full keyboard navigation (ArrowUp/Down/Enter)
- Namespaced IDs (`stgm-agent-*`) to avoid DOM collisions

## Benefits

- Platform builders can embed agent selection in their own UIs with 3 lines of code
- Single-select semantics match the domain constraint (one agent per session)
- Consistent visual language with existing pickers (search, scroll shadows, loading skeleton)
- Headless-first: `useAgentSearch` hook available for custom rendering, `AgentPicker` for drop-in use

## Impact

- **SDK**: New public exports from `@stigmer/react` — `AgentPicker`, `AgentPickerProps`
- **Platform builders**: Can use `AgentPicker` standalone or with their own popover
- **Stigmer Console**: Will consume via SessionComposer integration (T01.9, upcoming)

## Related Work

- [Agent Picker Project Kickoff and useAgentSearch](2026-03-19-103149-agent-picker-project-kickoff-and-useagentsearch.md) — T01.1 data hook
- Next: T01.3–T01.7 (environment and agent-instance hooks), T01.9 (SessionComposer integration)

---

**Status**: Production Ready
**Timeline**: ~1 hour (including architectural analysis of picker duplication)
