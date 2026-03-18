# GitHub Repo Picker UX Overhaul and Tailwind CSS Infrastructure Fix

**Date**: March 17, 2026

## Summary

Rewrote the `GitHubRepoPicker` component with owner-grouped sections, recent repos, keyboard navigation, scroll shadows, and search highlighting. Fixed a critical Tailwind CSS infrastructure issue where the SDK's `styles.css` was missing the `@source` directive, preventing Tailwind from scanning `.tsx` files and generating layout-critical utility classes.

## Problem Statement

The GitHub repository picker had several UX and technical issues that made it unsuitable for a platform-for-platforms SDK component.

### Pain Points

- Repository list was an unorganized flat list — users with many repos across multiple organizations had no grouping or hierarchy
- No scrolling constraint — the list expanded unboundedly, pushing the session launcher textarea off-screen
- No keyboard navigation — users were forced to use mouse-only interaction
- No recently selected repos — users had to search for the same repo every session
- Tailwind utility classes for layout (`justify-end`, `min-h-0`, `sticky`, `overflow-y-auto`) were silently missing from the generated CSS because Tailwind's content detection was not scanning SDK `.tsx` source files
- Complex flex nesting pattern (`flex flex-col max-h-[300px]` + `flex-1 min-h-0` + `h-full`) was fragile and did not reliably establish a scroll context, unlike the simpler pattern used by `FolderBrowser`
- No way to close the GitHub panel without disconnecting — users had to disconnect and reconnect to dismiss it
- `SessionLauncher` layout caused content overflow in some viewport sizes

## Solution

Two-pronged fix addressing both the CSS infrastructure and the component rewrite:

1. **Tailwind infrastructure**: Added `@source "./**/*.{ts,tsx}";` to `sdk/react/src/styles.css` so Tailwind's content scanner detects all SDK component class names
2. **Component rewrite**: Rebuilt `GitHubRepoPicker` with proper grouping, constrained scrollable layout matching `FolderBrowser`'s proven pattern, keyboard navigation, and localStorage persistence

## Implementation Details

### Tailwind CSS Infrastructure (`sdk/react/src/styles.css`)

- Added `@source "./**/*.{ts,tsx}";` directive at the top of the SDK stylesheet
- This tells Tailwind v4's content detection to scan all TypeScript/React source files in the SDK for class names
- Without this, only classes used in consumer apps (e.g., `client-apps/web`) were generated — SDK-internal classes were silently dropped
- The `@layer stgm` cascade ordering is preserved

### GitHubRepoPicker Rewrite (`sdk/react/src/github/GitHubRepoPicker.tsx`)

- **Owner-grouped sections**: Repos grouped by owner (personal repos first, then orgs sorted by repo count), with sticky section headers
- **Recent repos**: Last 3 selected repos persisted to `localStorage` and displayed in a pinned "Recent" group
- **Keyboard navigation**: Arrow keys cycle through items, Enter selects, Escape cancels — combobox ARIA pattern with `aria-activedescendant`
- **Search highlighting**: Matched substring is visually emphasized in search results
- **Scroll shadows**: Top/bottom gradient overlays indicate scrollable content, driven by scroll position detection
- **Constrained layout**: `max-h-64 overflow-y-auto` directly on the listbox — matches `FolderBrowser`'s proven pattern instead of complex flex nesting
- **Close/Cancel support**: `onCancel` prop + Escape key support, close button in GitHub panel header

### useGitHubRepos Refactoring (`sdk/react/src/github/useGitHubRepos.ts`)

- Increased `PER_PAGE` from 30 to 100 for fewer API round-trips
- Added `ownerType` field (`"User"` | `"Organization"`) to `GitHubRepo` for grouping
- Implemented eager background pagination: first page loads immediately, remaining pages fetched in background so client-side search covers the full repo set
- Added `isBackgroundLoading` state for "Loading more..." indicator
- Proper cancellation via `cancelled` ref when token changes

### WorkspaceEditor Enhancements (`sdk/react/src/workspace/WorkspaceEditor.tsx`)

- `GitHubPanel` receives `onClose` callback — renders close button in both connected and disconnected states
- `GitHubRepoPicker` receives `onCancel` prop wired to `onClose`
- Last selected folder path persisted to `localStorage` and restored as `FolderBrowser` initial path

### SessionLauncher Fixes (`client-apps/web/src/components/session/SessionLauncher.tsx`)

- Model selection persisted to `localStorage` (key: `stigmer:session:model`)
- Invalid persisted model IDs filtered via `getModel()` validation
- Fixed layout overflow: `justify-center` replaced with `overflow-y-auto`, inner content uses `my-auto` for vertical centering

### Folder Browser Default Path (`client-apps/cli/embedded/webconsole/api_fs.go`)

- Changed default path from CWD to home directory when no path is provided — more intuitive starting point for folder browsing

## Benefits

- **Immediate findability**: Owner grouping and search highlighting reduce time to find a repo from O(n) scanning to O(1) recognition
- **Session continuity**: Recent repos and persisted model/folder selections eliminate repetitive configuration
- **Reliable rendering**: Tailwind `@source` directive ensures all SDK utility classes are generated — eliminates an entire class of "styles not applying" bugs
- **Keyboard accessibility**: Full keyboard navigation meets WCAG combobox pattern requirements
- **Platform-ready layout**: Simple `max-h + overflow-y-auto` pattern (matching `FolderBrowser`) is robust, portable, and uses only standard Tailwind utilities — no custom CSS

## Impact

- **SDK consumers**: All Tailwind utility classes used in SDK components are now reliably generated. This was a silent infrastructure bug that could affect any SDK consumer using Tailwind v4.
- **End users**: GitHub repo selection is significantly faster and more ergonomic, especially for users with repos across multiple organizations.
- **Platform builders**: `GitHubRepoPicker` is now a proper combobox with clean props (`onCancel`, `onSelect`, `className`) suitable for embedding in custom UIs.

## Related Work

- Session 10: Initial GitHub OAuth workspace integration
- Session 13: Local folder browser (established the `max-h + overflow-y-auto` scroll pattern now adopted by `GitHubRepoPicker`)
- `_changelog/2026-03/2026-03-17-143646-github-oauth-credential-embedding.md`
- `_changelog/2026-03/2026-03-17-150749-local-folder-browser.md`

---

**Status**: Production Ready
**Timeline**: ~3 hours (iterative debugging of Tailwind infrastructure + component rewrite)
