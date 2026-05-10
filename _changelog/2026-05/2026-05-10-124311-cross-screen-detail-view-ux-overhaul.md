# Cross-screen resource detail view UX overhaul

**Date**: May 10, 2026

## Summary

Applied 6 uniform UX principles across all three resource detail views (Agent, MCP Server, Skill): consistent tab-to-content spacing, description as a labeled body section (not header subtitle), shared Section component with edit affordance and count badges, collection sections with header pencil icons, generic "Add" fallback for resource lists, editable sub-agents, and full DD-016 parity between web and desktop.

## Problem Statement

The three resource detail views had inconsistent UX patterns: description appeared in different locations (header vs. body vs. both), collection sections lacked edit affordances, sub-agents were hidden when empty, environment variable rows lacked visual separation, and the desktop app missed all inline editing capabilities that the web console had.

### Pain Points

- Description shown in 3 different places across 3 views (header subtitle, body section, or both)
- No visual breathing room between tab bar and first content section
- "Edit" affordance hidden until hover and placed at the bottom of cards
- Cannot add new MCP servers or skills without a domain-specific picker
- Sub-agents completely invisible when the list is empty
- Desktop users had zero inline editing capabilities
- Env var rows visually indistinct in edit mode

## Solution

Extracted a shared `Section` component with `onEdit` + `count` props, standardized description as a labeled body section in all views, added controlled editing mode to `InlineEditResourceList` and `InlineEditKeyValue`, implemented sub-agent inline add/edit/remove, and wired `editable` across both web and desktop client apps for all three resource types.

## Implementation Details

- **Shared primitives**: `Section.tsx` extracted to `resource-detail/`; `Tabs` panel gets `pt-4`; inline-edit components gain controlled `editing`/`onEditingChange` props
- **Agent**: Description uses `InlineEditTextarea` (multi-line); sub-agents always visible when editable with add form; all collections wired with header-edit pattern
- **MCP Server**: Description moved from header to body section; env section wired with header-edit; uses shared Section
- **Skill**: New `editable` prop; description and tag shown as labeled sections
- **Desktop parity**: All three desktop detail pages now pass `editable`; agent page removes old draft-session "Edit" button
- **Resource lists**: Generic org/slug add form when no domain picker is provided

## Benefits

- Consistent UX language across all resource types
- Desktop and web feature parity (DD-016)
- Collection fields clearly distinguished from scalar text fields
- Sub-agents discoverable and manageable inline
- Platform builders get the same improved patterns automatically

## Impact

- **SDK consumers**: New `Section` export; new props on inline-edit components (backward-compatible defaults)
- **Web + Desktop**: All detail pages gain inline editing; agent draft-session "Edit" button removed on desktop
- **Platform builders**: Shared Section component available for custom detail views

## Related Work

- Builds on Session 19 inline editing primitives
- Project: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/`

---

**Status**: Production Ready
**Timeline**: Single-session implementation (2026-05-10, Session 20)
