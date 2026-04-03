# Rename "Create" to "Add" and Fix Composer Guidance Text

**Date**: April 3, 2026

## Summary

Renamed all "Create" button labels to "Add" across the web console and docs site demos, replaced generic composer placeholder text with richer resource-specific guidance, and fixed a pre-existing bug where draft-mode headings and placeholders were lost after URL cleanup.

## Problem Statement

Users clicking "Create MCP Server" assumed the platform would provision actual infrastructure. In reality, the action registers an MCP server *configuration* — a blueprint definition added to the library catalog. The mismatch caused confusion reported by a product consumer.

### Pain Points

- "Create MCP Server" implied infrastructure provisioning rather than configuration registration
- The docs site MCP tour already used "Add MCP Server" but the live web console still said "Create" for all three resource types (Agent, Skill, MCP Server)
- The composer placeholder text ("Describe the agent you want to create...") was too generic — it didn't guide users on what information to provide
- A pre-existing bug in `SessionLauncher` meant the draft-mode placeholders and headings were never actually visible: `draftType` was derived from live search params that were cleaned immediately after reading, causing the values to revert to defaults

## Solution

Two coordinated changes plus a bug fix:

1. **Label rename**: "Create" → "Add" across all library list pages, the library landing dropdown, and docs site tour demos
2. **Richer composer guidance**: Context-specific placeholder text and headings that tell users exactly what information to provide for each resource type
3. **Draft param capture fix**: Captured `draftType` and `editRef` in React state (same pattern already used for `initialAgentRef`) so they survive the URL cleanup via `replaceState`

## Implementation Details

### Label Changes (11 files)

- `McpServerListPage.tsx`, `AgentListPage.tsx`, `SkillListPage.tsx` — button text
- `LibraryLanding.tsx` — dropdown trigger label, aria-label, renamed `CREATE_MENU_ITEMS` → `ADD_MENU_ITEMS` and `CreateResourceMenu` → `AddResourceMenu`
- `draft-session.ts` — JSDoc examples
- Agent and skill tour `index.tsx` and `steps.ts` — `createLabel` props and captions
- `ResourceListPage.tsx` — JSDoc comment

### Composer Guidance (`SessionLauncher.tsx`)

New `DRAFT_PLACEHOLDERS` with resource-specific copy:
- **Agent**: mentions purpose, skills, MCP servers, and system instructions
- **Skill**: mentions what it does, instructions, and workspace/file attachment
- **MCP Server**: uses "register" (not "create"), mentions name, connection type, command/URL, and env vars

New `DRAFT_HEADINGS` map provides context-specific headings ("Add an Agent", "Add a Skill", "Add an MCP Server") instead of the generic "What would you like to work on?"

### Bug Fix (`SessionLauncher.tsx`)

Introduced `capturedDraftType` and `capturedEditRef` state variables that snapshot the draft params on first availability. The existing `draftType` and `editRef` aliases now point to these stable captured values. The URL cleanup effect uses the live search param (`liveDraftType`) to trigger, but all downstream consumers (heading, placeholder, edit-mode fetching) read from captured state.

## Benefits

- Eliminates user confusion about what "Create MCP Server" does
- Aligns the web console with existing documentation language
- Guides users on exactly what information to provide for each resource type
- Fixes a bug where draft-mode guidance was never visible due to search param lifecycle

## Impact

- **Web console**: All three library list pages and the library landing dropdown
- **Docs site**: Agent and skill creation tour demos (MCP tour already used "Add")
- **Session launcher**: Placeholder and heading text now correctly displayed in draft mode

## Related Work

- MCP server creation tour in docs site already used "Add MCP Server" — now the console matches
- Domain model's blueprint vs. runtime separation (`_roles/001_architect.md`) informed the "Add" vocabulary choice

---

**Status**: ✅ Production Ready
