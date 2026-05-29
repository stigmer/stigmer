# Phase 2: Live Workspace File Explorer (Web-First Browsing)

**Date**: May 29, 2026

## Summary

Added live file tree browsing for workspace entries in the session inspector's Setup tab. Users can now expand a workspace entry to see its file listing before or during a session. The web console is wired first via the GitHub Trees API; desktop gets graceful degradation (no affordance shown) until a follow-up phase adds Tauri FS support.

## Problem Statement

Workspace entries were reference-only — a git URL or local path with no visibility into what's inside. Users couldn't verify they pointed at the right folder/repo before sending a message, and the inspector showed no file structure.

### Pain Points

- No way to browse files inside an attached workspace entry
- Users had to trust they picked the right repo/folder before starting
- No file-level context for workspace entries in the inspector panel
- Skill file browser had useful tree primitives but they were trapped inside a single component with no reuse path

## Solution

Implemented a capability-injection architecture (DD-004) where the SDK defines a `WorkspaceFileLister` callback and client apps provide platform-specific implementations. The file tree renders inline in the Setup tab as an accordion (master-detail), keeping workspace management and browsing unified rather than splitting across tabs.

## Implementation Details

### Shared file-tree primitives (pure refactor)
Extracted `TreeNode`, `buildFileTree`, and `FileTreeNode` from `SkillFileBrowser.tsx` into `sdk/react/src/internal/file-tree/`. Generalized `buildFileTree` input from `SkillFileEntry[]` to `{ path: string }[]` so both skill and workspace callers use the same utility. Added 11 unit tests for the tree builder — none existed previously.

### Lister contract + behavior hook
- `WorkspaceFileLister`: `(entry: WorkspaceEntry) => Promise<WorkspaceFileEntry[] | null>` — returns `null` when listing isn't supported for the entry type
- `useWorkspaceFiles`: behavior hook with per-entry-ID caching, loading/error states, `refresh()`, and graceful null-lister degradation. 8 unit tests.

### GitHub trees lister (web)
`useGitHubTreeLister(token)` calls the GitHub Trees API (`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`) using the existing client-side OAuth token. Filters to blob/tree entries, handles the API's `truncated` flag. Returns `undefined` when no token is available (opt-in). Includes a new `parseGitUrl` utility for owner/repo extraction. 19 unit tests across lister and parser.

### Inline accordion UI
Each workspace entry row in `SetupTab` becomes expandable when a lister is present. Only one entry expands at a time (accordion) to bound vertical space. The expanded panel shows a height-capped scrollable tree with loading skeletons, error + retry, empty state, and a refresh button.

### Threading and wiring
`workspaceFileLister` is an optional prop on `SessionViewer` and `NewSessionViewer`, threaded into `sessionConfig.workspaceActions`. Web pages (`SessionPage`, `SessionLauncher`) wire it via `useGitHubTreeLister(gitHubConnection.token)`. Desktop pages intentionally pass no lister — the affordance is hidden (DD-011 opt-in).

## Benefits

- Users can verify workspace content before sending a message
- Familiar master-detail interaction pattern (recognition over recall)
- Zero breaking changes — opt-in via the lister prop (DD-011)
- Shared file-tree primitives are now tested and reusable across skill and workspace UIs
- Platform builders embedding the SDK can provide their own lister implementation

## Impact

- **Web console users**: Can browse GitHub repo file trees for any attached workspace entry
- **Desktop users**: No change yet (Phase 3 adds Tauri FS support)
- **Platform builders**: New public exports — `WorkspaceFileLister`, `WorkspaceFileEntry`, `useWorkspaceFiles`, `useGitHubTreeLister`, `parseGitUrl`, `WorkspaceEntryFiles`
- **Existing behavior**: Fully preserved — no lister = no expand affordance = identical UX

## File Inventory

### New files (SDK)
| File | Purpose |
|------|---------|
| `sdk/react/src/internal/file-tree/tree-node.ts` | `TreeNode` type + `buildFileTree` utility |
| `sdk/react/src/internal/file-tree/FileTreeNode.tsx` | Recursive tree node component |
| `sdk/react/src/internal/file-tree/index.ts` | Barrel |
| `sdk/react/src/internal/file-tree/__tests__/buildFileTree.test.ts` | 11 unit tests |
| `sdk/react/src/workspace/WorkspaceFileLister.ts` | `WorkspaceFileLister` + `WorkspaceFileEntry` types |
| `sdk/react/src/workspace/useWorkspaceFiles.ts` | Behavior hook: entry -> tree via lister |
| `sdk/react/src/workspace/WorkspaceEntryFiles.tsx` | Expandable tree panel for one entry |
| `sdk/react/src/workspace/__tests__/useWorkspaceFiles.test.ts` | 8 unit tests |
| `sdk/react/src/github/parseGitUrl.ts` | GitHub URL -> owner/repo parser |
| `sdk/react/src/github/useGitHubTreeLister.ts` | GitHub Trees API lister |
| `sdk/react/src/github/__tests__/parseGitUrl.test.ts` | 8 unit tests |
| `sdk/react/src/github/__tests__/useGitHubTreeLister.test.ts` | 11 unit tests |

### Modified files
| File | Change |
|------|--------|
| `sdk/react/src/skill/SkillFileBrowser.tsx` | Import from `internal/file-tree` instead of local copies |
| `sdk/react/src/session/inspector/SetupTab.tsx` | `workspaceFileLister` in actions + accordion `WorkspaceEntryList` |
| `sdk/react/src/session/SessionViewer.tsx` | Accept + thread `workspaceFileLister` |
| `sdk/react/src/session/NewSessionViewer.tsx` | Accept + thread `workspaceFileLister` |
| `sdk/react/src/workspace/index.ts` | Export new types/hooks/components |
| `sdk/react/src/github/index.ts` | Export tree lister + parseGitUrl |
| `sdk/react/src/index.ts` | Public package exports |
| `client-apps/web/src/domain/session/SessionPage.tsx` | Wire `useGitHubTreeLister` |
| `client-apps/web/src/domain/session/SessionLauncher.tsx` | Wire `useGitHubTreeLister` |

## Related Work

- **Phase 1** (commit `c6bcb401c`): Unified session setup panel with interactive workspace add/remove
- **Phase 3** (deferred): Desktop Tauri FS file listing — stub at `_cursor/phase-3-desktop-workspace-files.md`
- **Phase 4** (deferred): Drag-to-reference via `workspace_file_refs` composer chip — stub at `_cursor/phase-4-workspace-file-references.md`
- Design spec: `_cursor/phase-2-workspace-file-explorer.md`

---

**Status**: Production Ready
**Timeline**: Single session
