# Phase 2: Local Folder Browser (Deferred)

**Status:** Documented, not yet implemented
**Depends on:** Phase 1 (Workspace GitHub OAuth Repo Picker) — completed

## Goal

Replace the local path text input with a backend-powered folder browser,
similar to Claude Code's directory selection experience. The user navigates
a visual tree instead of typing a raw path.

## Scope

- **Go CLI only** — this is a local-mode-only feature. The Java/cloud backend
  does not expose file system access.
- **No proto, no gRPC** — the directory listing endpoint is a plain HTTP API
  on the local CLI's web console server.
- **Frontend** — a new `FolderBrowser` component in `@stigmer/react` + wiring
  in the Console's `WorkspaceEditor`.

## Architecture

### Backend: Go CLI HTTP endpoint

**File:** `client-apps/cli/embedded/webconsole/handler.go`

Add an HTTP endpoint alongside the SPA handler:

```
GET /api/fs/list?path=/Users/foo/projects
```

Response:

```json
{
  "path": "/Users/foo/projects",
  "entries": [
    { "name": "my-app", "isDir": true },
    { "name": "notes", "isDir": true },
    { "name": "README.md", "isDir": false }
  ]
}
```

Implementation:
- Wrap the existing `spaHandler` in an `http.ServeMux` to route `/api/*`
  to API handlers and everything else to the SPA handler.
- Read directory entries with `os.ReadDir(path)`.
- Default to the user's home directory (`os.UserHomeDir()`) when `path`
  is empty.
- **Security:** Restrict to paths under the user's home directory. Reject
  symlinks that escape the home tree. Never expose this in Java/cloud.

### Frontend: SDK React FolderBrowser component

**File:** `sdk/react/src/workspace/FolderBrowser.tsx`

A navigable directory tree component:
- Starts at the user's CWD or home directory.
- Each directory row is expandable (lazy-loads children on click).
- "Select" button confirms the chosen directory path.
- Calls the local API endpoint (`/api/fs/list`) for each directory.
- Falls back to the text input if the endpoint is unavailable (e.g.,
  the component is used in a non-local context).

### Console integration

- The `WorkspaceEditor`'s "Local Folder" button already exists (Phase 1).
  In Phase 1 it shows a text input. In Phase 2, it renders `FolderBrowser`.
- Detection: the `enableLocal` prop on `WorkspaceEditor` is already wired
  to `deploymentMode === "local"` in `SessionLauncher.tsx`.

## Implementation checklist

- [ ] Add `http.ServeMux` routing to `handler.go` (`/api/*` → API, `/*` → SPA)
- [ ] Implement `GET /api/fs/list` handler with security restrictions
- [ ] Create `FolderBrowser` component in `sdk/react/src/workspace/`
- [ ] Replace text input in `WorkspaceEditor` local panel with `FolderBrowser`
- [ ] Test: navigating directories, selecting a folder, error states
- [ ] Test: endpoint not available when running in cloud mode (hidden UI)
