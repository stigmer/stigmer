# Workspace Source Selection Driven by Execution Target

**Date**: May 29, 2026

## Summary

Centralized workspace source policy into a new SDK behavior hook (`useWorkspaceSources`) so workspace picker options are driven by execution target rather than ad-hoc per-site flags. Desktop (local execution) now shows only "Browse Folder"; web (cloud execution) shows only "Connect GitHub". Fixed the desktop session-page follow-up composer that previously showed only "Connect GitHub" with no way to add a local folder.

## Problem Statement

The desktop app's session-page follow-up composer displayed a "Connect GitHub" button as the sole workspace action, even though the desktop runs with `executionTarget="local"` and uses an embedded runner that operates on local files. The GitHub OAuth flow is irrelevant in this context -- users need the native folder picker instead.

### Pain Points

- Desktop session page never passed `onBrowseLocalFolder` to `SessionViewer`, and `SessionViewer` didn't accept that prop, so the "Browse Folder" action was structurally impossible in the follow-up composer.
- Each consumer site (desktop launcher, desktop session page, web launcher, web session page) independently decided `enableGitHub` / `enableLocal` with ad-hoc boolean props, violating DD-016 (client-app parity).
- Web pages used `enableLocal={deploymentMode === "local"}` while desktop hardcoded `enableGitHub enableLocal`, creating divergent logic for the same concern.

## Solution

Introduced a shared SDK behavior hook that reads execution target from `StigmerProvider` context and returns the correct `{ enableGitHub, enableLocal }` pair. All four consumer sites now call this single hook, eliminating duplicated conditional logic.

## Implementation Details

### New hook: `useWorkspaceSources` (`sdk/react/src/workspace/useWorkspaceSources.ts`)

Reads `useExecutionTarget()` (provider-level) and falls back to `useDeploymentMode()`:
- **Cloud** -> `{ enableGitHub: true, enableLocal: false }`
- **Local + native picker** -> `{ enableGitHub: false, enableLocal: true }`
- **Local + no picker** -> `{ enableGitHub: true, enableLocal: true }` (safety fallback for web-local OSS)

Accepts `{ hasLocalPicker?: boolean }` so desktop can declare its Tauri dialog capability.

### SessionViewer prop addition

Added `onBrowseLocalFolder?: () => Promise<string | null>` to `SessionViewerProps` and threaded it through the internal `ConversationColumn` into the follow-up `SessionComposer`. This brings the session page's composer to parity with the launcher (DD-016).

### Client-app wiring (all four sites)

- **Desktop launcher/page**: `useWorkspaceSources({ hasLocalPicker: true })` + `useNativeFolderPicker()`. Removed `useDesktopGitHubConnection` dependency.
- **Web launcher/page**: `useWorkspaceSources()` (no picker). Removed ad-hoc `useDeploymentMode` dependency for this concern.

### Tests

9 unit tests covering all permutations of `{local, cloud, undefined} x {hasLocalPicker true/false} x {deploymentMode local/cloud}` plus reference stability. All 14 workspace tests and 97 session tests pass.

## Benefits

- Desktop users see "Browse Folder" on the session page (previously broken).
- GitHub OAuth flow is hidden on desktop where it adds no value.
- Single policy source for workspace options across all four consumer sites.
- Future execution-target changes propagate automatically without touching client apps.

## Impact

- **Desktop app**: Session page follow-up composer now shows the native folder picker. Launcher behavior unchanged (already had the picker, now without unnecessary GitHub button).
- **Web app**: No user-visible change in cloud deployment. Web-local OSS retains GitHub as a fallback workspace source.
- **SDK consumers**: New `useWorkspaceSources` hook available for platform builders who embed `SessionComposer` or `WorkspaceEditor`.

## Related Work

- DD-016 (client-app parity) -- this change enforces parity across all four consumer sites
- DD-003/DD-004 (headless-first, no framework deps in SDK) -- the hook reads from SDK context, not framework-specific APIs

---

**Status**: Production Ready
