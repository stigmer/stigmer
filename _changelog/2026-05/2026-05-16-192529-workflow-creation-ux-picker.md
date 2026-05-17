# Workflow Creation UX — New Workflow Page with Creation Picker

**Date**: May 16, 2026

## Summary

Added a unified "New Workflow" creation path to both web and desktop apps, giving users two ways to create workflows: a visual drag-and-drop editor or AI-powered generation. Previously, the visual canvas editor was only accessible as a tab on existing workflow detail pages, making it completely unreachable when no workflows existed.

## Problem Statement

The visual canvas editor (Phase 2, T15) was fully built and functional inside `WorkflowEditorView`, but was only accessible as an "Editor" tab on an existing workflow's detail page. Users with zero workflows had no way to reach it from the UI.

### Pain Points

- Users with no workflows saw an empty list with only a "Generate" button — no manual creation path
- The visual editor (drag-and-drop canvas) was invisible to new users
- The Library "Add" dropdown included Agent, Skill, and MCP Server but not Workflow
- No `/library/workflows/new` route existed in either web or desktop apps

## Solution

Added a `/library/workflows/new` route in both web and desktop apps with a two-card creation picker (matching the agent `CreationPicker` pattern). Replaced the two-button layout on the list page with a single "Create" button, and added "Workflow" to the Library landing Add menu.

## Implementation Details

### SDK Changes
- **`starter-workflow-yaml.ts`**: New `STARTER_WORKFLOW_YAML` constant — minimal valid workflow with one `agent_call` task
- **`WorkflowEditorView`**: Added `defaultMode?: WorkflowEditorMode` prop (defaults to `"code"` for backward compat), enabling the new page to start in visual mode
- **Barrel exports**: `STARTER_WORKFLOW_YAML` and `WorkflowEditorMode` exported from both workflow barrel and top-level SDK barrel

### WorkflowNewPage (web + desktop)
- Three-phase state machine: `"picking"` | `"editor"` | `"generating"`
- **Picking phase**: Two option cards matching `CreationPicker` visual style — "Visual Editor" (grid icon) and "Generate with AI" (sparkles icon)
- **Editor phase**: `WorkflowEditorView` with starter YAML in visual mode, with back navigation
- **Generating phase**: `WorkflowArchitectDialog` opens; closing returns to picker; success navigates to new workflow detail page

### WorkflowListPage (web + desktop)
- Single "Create" button (primary style, Plus icon) linking to `/library/workflows/new`
- Removed `WorkflowArchitectDialog` from list page (moved to new page)
- Updated empty state text

### LibraryLanding (web)
- Added "Workflow" entry to the Add menu with direct link to `/library/workflows/new`
- Refactored `ADD_MENU_ITEMS` from `DraftResourceType`-based to generic `href`-based items

### Desktop Routes
- Added `workflows/new` route before `workflows/:org/:slug` to avoid param collision

## Benefits

- Users can now create workflows from the UI without needing CLI or API access
- The visual canvas editor is discoverable from the first interaction
- Consistent UX pattern across resource types (agents, workflows, skills, MCP servers all have creation flows)
- Two clear creation paths: manual (visual editor) and AI-assisted (generate)

## Impact

- **SDK React**: 3 new/modified files (starter YAML, editor view, barrel exports)
- **Web app**: 3 new/modified files (new page, list page, library landing)
- **Desktop app**: 3 new/modified files (new page, list page, routes)
- **DD-016 parity**: Web and desktop pages are structurally identical

## Related Work

- Parent project: `20260508.01.bring-workflows-to-foreground` (Phase 2, T15 — Visual Builder)
- Sub-project: `20260515.01.sp.agent-powered-workflow-generation` (WorkflowArchitectDialog)

---

**Status**: Production Ready
**Timeline**: 1 session
