# Design Decision 003: AgentPicker as Single-Select

**Date**: 2026-03-19
**Status**: Accepted

## Context

The session composer has multi-select pickers for MCP servers and skills. The agent picker is different: a session runs against exactly one agent.

## Decision

The AgentPicker uses the same UI pattern (searchable list in a popover, like McpServerPicker and SkillPicker) but with single-select semantics:

- `value: ResourceRef | null` (not `ResourceRef[]`)
- `onChange: (ref: ResourceRef | null) => void`
- Clicking a result replaces the current selection
- At most one agent chip in the composer

Named `AgentPicker` (not `AgentSelector`) because it follows the searchable-list-in-popover UI pattern of the other pickers, not the dropdown pattern of `ModelSelector`.

## Toolbar Position

Agent appears as the first toolbar item (before Workspace, MCP, Skills) because the agent selection has the highest impact on session behavior.

## Consequences

- Consistent visual language with existing pickers
- Single-select behavior is expressed through the props API
- Platform builders can use `useAgentSearch` headless-first without the styled component
