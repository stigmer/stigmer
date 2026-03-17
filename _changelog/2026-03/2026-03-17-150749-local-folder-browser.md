# Local Folder Browser for Workspace Selection

**Date**: March 17, 2026

## Summary

Replaced the raw text input for local workspace paths with a backend-powered folder browser. Users can now visually navigate their filesystem to select project directories instead of typing exact paths. The feature is local-mode only — the endpoint exists exclusively on the Go CLI's web console server and the UI is hidden in cloud mode.

## Problem Statement

The "Local Folder" workspace source required users to type an exact filesystem path (e.g., `/Users/foo/projects/my-app`) with no validation, autocomplete, or visual feedback. This violated Recognition Over Recall (Nielsen heuristic #6) — users had to remember and type paths from memory.

### Pain Points

- Users must know the exact path ahead of time
- No feedback on whether the path exists or is valid
- No way to explore the filesystem to find the right directory
- Error only surfaces at session creation time, not at input time

## Solution

A three-layer implementation following the SDK headless-first pattern:

1. **Go HTTP endpoint** (`GET /api/fs/list`) on the CLI's web console server for directory listing
2. **SDK data hook** (`useFolderListing`) and **styled component** (`FolderBrowser`) in `@stigmer/react`
3. **Console integration** via a new `enableFolderBrowser` prop on `WorkspaceEditor`

## Implementation Details

### Backend: Go HTTP Endpoint

- New `api_fs.go` in `client-apps/cli/embedded/webconsole/` with `handleFSList` handler
- `NewSPAHandler()` now returns an `http.ServeMux` wrapping the existing SPA handler — routes `/api/fs/list` to the new handler, everything else to the SPA
- Response includes `path`, `cwd` (CLI launch directory), `home` (user home), and sorted `entries` with `isDir` and `hidden` flags
- Proper error codes: 400 for non-absolute paths, 404 for missing directories, 403 for permission denied
- Symlinks resolved to determine `isDir`; no path restrictions (industry standard for local tools)

### SDK: Data Hook + Styled Component

- `useFolderListing` — data hook with `fetch`, abort controller, LRU cache (32 entries), and `isAvailable` flag for endpoint detection
- `FolderBrowser` — styled component with breadcrumb path bar (clickable segments, editable as text input), directory listing, Home/CWD quick navigation, hidden files toggle, keyboard navigation (Arrow/Enter/Escape/Backspace), loading skeletons, error states, and graceful fallback to text input when endpoint is unavailable
- All visual properties flow through `--stgm-*` tokens

### Console Integration

- `WorkspaceEditor` gains `enableFolderBrowser` prop (default: false, backward compatible)
- `SessionLauncher` passes `enableFolderBrowser={deploymentMode === "local"}`

### Security Model

- No path restrictions — matches VS Code, Jupyter, Docker Desktop, code-server industry standard
- `127.0.0.1` binding already in place (localhost only)
- OS-level permissions inherited (no privilege escalation)
- Cloud mode excluded — Java backend never implements the endpoint, frontend hides the button
- Read-only — endpoint can only list, never modify

## Benefits

- Users visually browse and select project directories (recognition over recall)
- Quick navigation to Home and CWD directories
- Hidden files toggle reduces noise while remaining accessible
- Power users can still type paths directly via the breadcrumb address bar
- Graceful degradation when endpoint is unavailable (falls back to text input)
- Platform builders get the same component via `@stigmer/react` exports

## Impact

- **Direct users**: Significantly improved local workspace selection UX
- **Platform builders**: New `useFolderListing` hook and `FolderBrowser` component available for embedding
- **Backend**: Minimal footprint — one new file, one routing change, no proto changes

## Related Work

- Phase 1: GitHub OAuth Workspace Integration (completed in prior session)
- T01.5: Web — New Session Launcher (where workspace selection lives)

---

**Status**: Production Ready
**Scope**: Go CLI backend + SDK React + Web Console
