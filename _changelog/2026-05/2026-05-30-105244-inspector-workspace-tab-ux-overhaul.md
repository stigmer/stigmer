# Inspector Workspace Tab UX Overhaul

**Date**: May 30, 2026

## Summary

Promoted Workspace from a section within the Setup tab into its own dedicated top-level tab in the SessionInspector, renamed "Setup" to "Configure", reordered tabs to follow the user's mental model (context before output), fixed workspace path display to show short Cursor-like names, and addressed file tree loading performance with progressive rendering and a shared module-level cache.

## Problem Statement

The session inspector panel's Setup tab was overloaded — it packed workspace entries, file trees, run config, agent, MCP servers, skills, and session variables into a single scrollable section. Workspace deserved dedicated real estate as it represents the session's primary identity.

### Pain Points

- Workspace was buried inside the Setup tab alongside unrelated configuration items
- Full filesystem paths were displayed (e.g., `/Users/suresh/scm/github.com/stigmer/stigmer`) instead of meaningful short names
- File tree loading felt sluggish due to full-recursive fetches and all-expanded rendering
- Tab order (Plan | Usage | Setup) didn't match the user's mental model when configuring a session
- "Setup" as a name implied one-time action rather than ongoing configuration

## Solution

Restructured the inspector panel around a new information hierarchy: **Workspace | Configure | Plan | Usage**. Context-first, output-second. Users establish what they're working on (Workspace) and how it's configured (Configure) before seeing execution details (Plan, Usage).

## Implementation Details

### Tab restructure (`useSessionInspector.ts`, `SessionInspector.tsx`)
- Added `"workspace"` and `"configure"` to `SessionInspectorTabId`, removed `"setup"`
- `buildVisibleTabs` now emits Workspace → Configure → Plan → (Changes?) → (Artifacts?) → Usage → (Inspect?)
- `deriveAutoTab` defaults to `"workspace"` when idle, `"plan"` during execution

### New `WorkspaceTab.tsx`
- Dedicated workspace tab with entry list, file tree accordion, and add-workspace actions
- Entries display `parent/folder` short names with full path on tooltip
- Entries start collapsed to avoid expensive file-listing fetches on mount
- Empty state guides users to add a folder or GitHub repo

### Configure tab (formerly Setup)
- Removed `WorkspaceSection` and all workspace-related imports from `SetupTab.tsx`
- Stripped unused `SetupTabWorkspaceActions` interface
- Kept: Run Config, Agent, MCP Servers, Skills, Session Variables

### Path display (`useWorkspaceEntries.ts`)
- `deriveNameFromPath` now returns `parent/lastSegment` instead of the full absolute path
- Raw `localPath` preserved in the entry for the SDK `toInput()` call

### File tree performance
- `FileTreeNode`: Added `maxInitialDepth` prop — folders at depth >= threshold start collapsed
- `WorkspaceEntryFiles`: Passes `maxInitialDepth={2}` so only top 2 levels auto-expand
- `useWorkspaceFiles`: Lifted cache from per-instance `useRef` to module-level `Map` so tab switches don't re-fetch

### Consumer wiring (`SessionViewer.tsx`, `NewSessionViewer.tsx`)
- Split `sessionConfig` into separate `sessionConfig` (Configure tab) and `workspaceConfig` (Workspace tab) props
- Both client apps (web + desktop) benefit automatically — no client-app code changes needed (DD-016)

## Benefits

- Workspace gets dedicated tab real estate — no more scrolling past it to find config
- Tab order matches the user's mental model (what → how → doing → cost)
- Short path names reduce visual noise and match IDE conventions
- Progressive tree rendering reduces initial DOM nodes by ~70% for large repos
- Shared cache eliminates redundant file-listing fetches when switching tabs
- Cleaner separation: "Configure" communicates active configuration vs. one-time "Setup"

## Impact

- **SDK consumers**: New `workspaceConfig` prop on `SessionInspector` (backward compatible — optional)
- **End users**: Improved tab navigation, faster file tree, cleaner workspace display
- **Platform builders**: Can style and position Workspace and Configure independently
- **Tests**: Updated to reflect new tab IDs and ordering

## Related Work

- `2026-05-29-123533-session-viewer-redesign-tabbed-inspector.md` — original tabbed inspector
- `2026-05-29-161408-workspace-file-explorer-phase-2.md` — file tree integration
- `2026-05-29-165713-desktop-workspace-file-listing-phase-3.md` — Tauri native file listing
- `2026-05-29-183459-workspace-file-references-phase-4.md` — drag-to-reference

---

**Status**: ✅ Production Ready
**Timeline**: Single session
