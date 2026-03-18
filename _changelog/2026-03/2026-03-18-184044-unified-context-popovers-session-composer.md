# Unified Context Popovers for SessionComposer

**Date**: March 18, 2026

## Summary

Implemented a unified popover-based UX pattern for all three session-level context types (workspace, MCP servers, skills) in the `SessionComposer` component. Selected items render as removable chips inside the composer card, providing immediate visibility and direct manipulation. All pickers are SDK-first components in `@stigmer/react`, ready for third-party embedding.

## Problem Statement

The `SessionComposer` previously only supported workspace selection, rendered as an inline block below the card. As MCP server and skill context were added to the session proto (T01.1-T01.6), users needed a way to attach these at session creation time. The existing workspace UX pattern (inline expansion) would not scale to three context types — it would vertically dominate the composer and create inconsistent interaction models.

### Pain Points

- No UI for selecting MCP servers or skills at session creation time
- Workspace editor rendered inline below the card, inconsistent with the emerging multi-context model
- No unified interaction pattern across context types
- Search and selection logic would need duplication across pickers without abstraction

## Solution

Adopted a popover-trigger pattern unified across all three context types:

1. **Toolbar buttons** — compact icon buttons in the composer toolbar open floating popovers
2. **Popover pickers** — each context type gets a dedicated picker component rendered inside a `@base-ui/react/popover`
3. **Chip display** — selected items appear as removable pills inside the composer card between the textarea and toolbar
4. **Reusable search hook** — a generic `_useResourceSearch` hook centralizes debounced API search, loading/error states, and cancellation

## Implementation Details

### New Modules in `@stigmer/react`

- **`src/search/useResourceSearch.ts`** — Internal reusable hook wrapping `ListParams`-based API calls with debounced search, loading states, and cancellation via `AbortController`. Parameterized by `listFn` so any resource type can reuse it.
- **`src/mcp-server/`** — `useMcpServerSearch` hook (thin wrapper binding to `stigmer.mcpServer.list()`) and `McpServerPicker` component with search input, scrollable list, keyboard navigation, and toggle selection.
- **`src/skill/`** — `useSkillSearch` hook (thin wrapper binding to `stigmer.skill.list()`) and `SkillPicker` component, structurally identical to `McpServerPicker` but adapted for skill resources.

### SessionComposer Refactor

- Removed inline `WorkspaceEditor` rendering below the card
- Added `ContextTriggerButton` — compact toolbar buttons for each context type
- Added `ContextPopover` — wrapper around `@base-ui/react/popover` with consistent positioning and styling
- Added `ContextChip` — removable pills for selected items with human-readable display names cached in internal state
- Workspace, MCP servers, and skills all use the same trigger-popover-chip pattern
- New props: `org`, `mcpServerUsages`, `onMcpServerUsagesChange`, `skillRefs`, `onSkillRefsChange`
- Presence of `onChange` callbacks implicitly enables the corresponding picker (no extra boolean props)

### Console Integration

- `SessionLauncher` manages `mcpServerUsages` and `skillRefs` state, passes to `SessionComposer`, and includes them in `createSession`
- `SessionPage` manages mid-conversation MCP/skill state, passes to `SessionComposer`, and wires into `sendFollowUp` options

## Benefits

- **Consistent UX** — all three context types follow the same interaction model (Jakob's Law)
- **Scalable** — adding future context types follows the established pattern with minimal code
- **SDK-first** — all components and hooks live in `@stigmer/react`, zero Console dependencies
- **Themeable** — all visual properties flow through `--stgm-*` CSS tokens
- **Embeddable** — platform builders get `McpServerPicker`, `SkillPicker`, `useMcpServerSearch`, `useSkillSearch` as independent exports
- **Code reuse** — `_useResourceSearch` eliminates duplicated search/loading/error logic

## Impact

- **SDK consumers** — can now embed MCP server and skill selection in their own session creation flows
- **Console users** — single-screen session launcher now supports the full context composition: message + workspace + skills + MCP servers + model
- **Platform builders** — headless hooks available for custom picker implementations

## Related Work

- T01.1-T01.6: Proto schema, stub generation, SDK codegen, backend verification, and React hook updates that provided the data layer for these UI components
- `d8539434 feat(sdk/react): add unified SessionComposer component` — original SessionComposer creation
- `136ec8d9 feat(sdk/react): add MCP server and skill support to session hooks` — hook-level MCP/skill support

---

**Status**: Production Ready
**Timeline**: Session 4 of project 20260318.01.session-context-composition
