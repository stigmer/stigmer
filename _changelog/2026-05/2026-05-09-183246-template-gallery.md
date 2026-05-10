# T04-F: Template Gallery for Resource Creation Wizards

**Date**: May 9, 2026

## Summary

Added a template gallery system to `@stigmer/react` that provides pre-built agent and MCP server configurations as starting points for the creation wizards. Introduced a "creation picker" landing page that unifies the three creation paths (blank, template, import) into a single discoverable entry point, replacing the previous direct-to-wizard behavior.

## Problem Statement

Users had only two ways to create agents and MCP servers: start from a blank wizard or import a YAML file. Both required users to either know exactly what they wanted or have a pre-existing configuration file. There was no middle ground — no curated starting points that reduce time-to-value for common patterns.

### Pain Points

- New users faced a blank wizard with no guidance on what a good agent configuration looks like
- The three creation paths (blank, template, import) were scattered — blank was the wizard, import was a separate icon on the list page toolbar
- No pre-built configurations for common use cases (customer support, code review, GitHub integration, etc.)
- Platform builders embedding the SDK had no way to provide curated templates to their end users

## Solution

Built a complete template gallery system following the SDK-first, headless-first architecture:

1. **Template types and static data** — `ResourceTemplate<TData>` generic type with 5 agent templates and 4 MCP server templates bundled in the SDK
2. **Headless filter hook** — `useTemplateFilter` for category filtering and text search, independently usable by platform builders
3. **Styled gallery components** — `TemplateCard`, `TemplateGallery`, `CreationPicker` with theme token compliance and keyboard navigation
4. **Wizard `initialData` prop** — Non-breaking addition to both `AgentCreationWizard` and `McpServerCreationWizard` enabling template pre-fill
5. **Console integration** — `AgentNewPage` and `McpServerNewPage` now show a creation picker with picking -> wizard state machine

## Implementation Details

### New SDK Components

| Component | Purpose |
|-----------|---------|
| `ResourceTemplate<TData>` | Generic type for template definitions |
| `TemplateCategory` | Union type for gallery filtering |
| `AGENT_TEMPLATES` | 5 built-in agent templates (Customer Support, Code Review, Data Analysis, Content Writer, DevOps Assistant) |
| `MCP_SERVER_TEMPLATES` | 4 built-in MCP server templates (GitHub, Slack, PostgreSQL, Filesystem) |
| `useTemplateFilter` | Headless hook for category + text search filtering |
| `TemplateCard` | Clickable card with initial avatar, category badge, keyboard a11y |
| `TemplateGallery` | Searchable card grid with category tabs and arrow-key navigation |
| `CreationPicker` | "Step 0" landing with scratch/template/import option cards |

### Key Design Decisions

- **DD-T04F-001**: Creation landing page as local state transition (not a route change) — lightweight, one click to wizard
- **DD-T04F-002**: Static TypeScript templates in SDK — no backend dependency, platform builders can pass own arrays
- **DD-T04F-003**: Wizard `initialData` prop merges with defaults — non-breaking, enables template pre-fill and future duplicate flows
- **DD-T04F-004**: No template provenance tracking yet — deferred to reduce complexity
- **No string icon field**: Removed planned lucide icon strings since SDK has zero lucide-react dependency; uses deterministic colored initials matching `ResourceAvatar` pattern

### Files Changed

**New files (8)**:
- `sdk/react/src/resource-creation/templates/{types,agent-templates,mcp-server-templates,index}.ts`
- `sdk/react/src/resource-creation/{useTemplateFilter,TemplateCard,TemplateGallery,CreationPicker}.tsx`

**Modified files (10)**:
- `sdk/react/src/agent/AgentCreationWizard.tsx` — `initialData` prop
- `sdk/react/src/mcp-server/McpServerCreationWizard.tsx` — `initialData` prop
- `sdk/react/src/agent/index.ts` — export `AgentWizardData`
- `sdk/react/src/mcp-server/index.ts` — export `McpServerWizardData`
- `sdk/react/src/resource-creation/index.ts` — barrel exports
- `sdk/react/src/index.ts` — root barrel exports
- `client-apps/web/.../AgentNewPage.tsx` — picker state machine
- `client-apps/web/.../McpServerNewPage.tsx` — picker state machine
- `sdk/react/src/resource-creation/StepIndicator.tsx` — Prettier formatting
- `sdk/react/src/resource-creation/WizardShell.tsx` — Prettier formatting

## Benefits

- **Faster onboarding**: New users can start with a well-crafted template instead of a blank form
- **Unified creation UX**: All three creation paths (blank, template, import) discoverable from one screen
- **Platform builder extensibility**: `templates` prop on `TemplateGallery` and `CreationPicker` — pass your own templates
- **Headless adoption**: `useTemplateFilter` works independently of the styled components
- **Non-breaking**: Existing wizard usage continues to work — `initialData` is optional

## Impact

- **End users**: See a creation picker instead of a blank wizard when visiting `/library/agents/new` or `/library/mcp-servers/new`
- **Platform builders**: Can provide curated templates to their users via the SDK
- **SDK public API**: 13 new exports (types, components, hook, data arrays)

## Related Work

- T04-A: ResourceWorkbench Creation Slot (provides the entry point)
- T04-B: Agent Creation Wizard (receives `initialData`)
- T04-D: MCP Server Creation Wizard (receives `initialData`)
- T04-E: YAML/JSON Import/Export (import path integrated into creation picker)

---

**Status**: Production Ready
**Timeline**: 1 session (~1.5 hours)
