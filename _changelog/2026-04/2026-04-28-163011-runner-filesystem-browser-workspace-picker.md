# Runner Filesystem Browser -- Unified Workspace Picker

**Date**: April 28, 2026

## Summary

Replaced the "Local Folder" workspace picker with a unified in-app filesystem browser that queries the runner's filesystem via the existing `ListDirectory` command stream. Both web and desktop now use the same `RunnerFileBrowser` component, eliminating the disconnected native OS dialog on desktop and the raw text input on web.

## Problem Statement

The "Local Folder" workspace attachment UX was the weakest link in the session creation flow across both client surfaces.

### Pain Points

- **Desktop (Tauri)**: Clicking "Local Folder" opened the OS native folder dialog -- a jarring, disconnected experience that broke the flow of the in-app UI
- **Web (local mode)**: Showed a raw text input requiring users to type an absolute path manually -- error-prone and unfriendly
- **No consistency**: Desktop used a native dialog, web used a text input -- two completely different experiences for the same action
- **Missing infrastructure utilization**: The `ListDirectory` runner command, bidi stream relay, and `sendCommand` API were already implemented end-to-end but had no frontend consumer

## Solution

Built a `RunnerFileBrowser` component in `@stigmer/react` that uses the existing `ListDirectory` runner command to provide a visual directory browser. When a user clicks "Local Folder", they now see an in-app file browser with breadcrumb navigation, directory listing, and shortcut buttons -- identical on web and desktop.

## Implementation Details

### New files

- **`sdk/react/src/runner/useRunnerFileBrowser.ts`** -- Behavior hook wrapping `runner.sendCommand()` with `ListDirectory`. Manages navigation state via reducer (current path, entries, breadcrumbs, loading/error, hidden files toggle). Includes stale-response guards for race conditions during rapid navigation.

- **`sdk/react/src/runner/RunnerFileBrowser.tsx`** -- Styled component composing the hook into a visual browser:
  - Breadcrumb path bar with clickable segments
  - Shortcut buttons: Home, CWD (current working directory), Up
  - Directory listing with folder/file icons (directories clickable, files displayed read-only)
  - Hidden files toggle (dotfiles)
  - Select/Cancel actions
  - Loading skeleton, error display with retry, empty directory state

- **`sdk/react/src/runner/__tests__/useRunnerFileBrowser.test.tsx`** -- 9 tests covering initial fetch, null runnerId (inert), child/parent navigation, runner error responses, network errors, hidden toggle, retry, and root detection.

### Modified files

- **`sdk/react/src/workspace/WorkspaceEditor.tsx`** -- Restructured from "two toggle buttons + expandable panels" into a tabbed layout. When both sources are available (runner + GitHub), a segmented tab bar shows "Local Folder" (default) and "GitHub Repo". Local Folder tab renders `RunnerFileBrowser` immediately on popover open -- no extra click. When only one source is available (e.g., cloud mode with no runner), content renders directly without a tab bar. Marked `onBrowseLocalFolder` as `@deprecated`.

- **`sdk/react/src/composer/SessionComposer.tsx`** -- Expanded runner list fetching to also serve workspace browsing needs. Computes `browseRunnerId`: uses explicitly selected runner, or falls back to the first active (READY/BUSY) runner from the list. Passes this to `WorkspaceEditor`.

- **`client-apps/desktop/src/pages/SessionLauncher.tsx`** and **`SessionPage.tsx`** -- Removed `useNativeFolderPicker` usage and enabled GitHub (`enableGitHub` was previously `false` on desktop). Both web and desktop now show both workspace sources.

- **`sdk/react/src/runner/index.ts`** and **`sdk/react/src/index.ts`** -- Added exports for `RunnerFileBrowser`, `RunnerFileBrowserProps`, `useRunnerFileBrowser`, `UseRunnerFileBrowserReturn`, `PathSegment`.

### Architecture: no backend changes needed

The full command relay pipeline was already implemented:

1. **Proto**: `ListDirectoryRequest` / `ListDirectoryResponse` / `DirectoryEntry` in `runner/v1/io.proto`
2. **CLI Runner (Go)**: `handleListDirectory` in `runner_stream_commands.go` -- `os.ReadDir` with path resolution
3. **Server relay (Go)**: `SendCommand` in `send_command.go` -- routes via bidi stream registry
4. **TypeScript SDK**: `runner.sendCommand()` in `sdk/typescript/src/gen/runner.ts`

This work was purely frontend -- connecting the existing infrastructure to the user.

### Auto-mode fallback

When the user hasn't explicitly selected a runner (Auto mode), `SessionComposer` picks the first active runner from the list for browsing purposes. Execution routing remains "Auto" -- only the file browser needs a specific runner to talk to.

## Benefits

- **Unified UX**: Identical file browsing experience on web and desktop
- **No more blind path typing**: Users visually navigate the runner's filesystem
- **Leverages existing infra**: Zero new proto definitions, zero new server code, zero new CLI code
- **SDK-first**: Component lives in `@stigmer/react`, available to platform builders embedding Stigmer
- **Headless-first**: `useRunnerFileBrowser` hook is exported separately for custom rendering
- **Graceful degradation**: Falls back to text input when no runner is available

## Impact

- **End users**: Significantly improved workspace selection experience on both surfaces
- **Desktop app**: Removed dependency on `@tauri-apps/plugin-dialog` for folder selection
- **Platform builders**: New `RunnerFileBrowser` component and `useRunnerFileBrowser` hook available for custom integrations
- **Codebase**: `useNativeFolderPicker` is now unused dead code (can be removed in a follow-up cleanup)

## Related Work

- Runner command stream: `20260422.02.runner-command-stream` -- established the `ListDirectory` command and bidi stream relay
- Desktop-web UX parity: `20260426.01.desktop-web-ux-parity` -- broader effort to align desktop and web experiences
- Web SDK architecture: `20260423.01.web-sdk-architecture-standards` -- SDK-first development patterns followed here

---

**Status**: Production Ready
