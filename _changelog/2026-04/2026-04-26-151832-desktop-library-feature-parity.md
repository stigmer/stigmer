# Desktop Library Feature Parity

**Date**: April 26, 2026

## Summary

Closed five library feature gaps between the desktop and web apps by wiring existing SDK components into desktop library pages. All building blocks already existed in `@stigmer/react` — the changes are pure consumer-side wiring with zero new SDK code. Desktop library pages now have full functional parity with the web console.

## Problem Statement

The T02 desktop shell rebuild delivered the core app shell (sidebar, settings, breadcrumbs), but a duplication audit identified five library-specific UX gaps where the web console used SDK capabilities that the desktop app did not consume.

### Pain Points

- Desktop list pages had no page headers — users saw a search bar with no context about what resource type they were browsing
- Scope preference (Org vs All) reset to "Org" on every page navigation — users had to re-select their preference repeatedly
- MCP server list had no inline connect action — users had to navigate to the detail page just to initiate server discovery
- Detail pages showed a static "Public" pill instead of an interactive visibility toggle — users couldn't change resource visibility from the desktop app
- Agent detail page had no Edit button — users couldn't initiate an edit session from the detail view

## Solution

Wire existing SDK hooks and components into the six desktop library page files, mirroring the patterns already established in the web console. No architectural changes, no new abstractions, no SDK modifications.

## Implementation Details

**List pages** (`AgentListPage.tsx`, `SkillListPage.tsx`, `McpServerListPage.tsx`):
- Added page headers with `h1` title, description paragraph, and "Add" action using react-router `Link` to `/?draft={type}`
- Added `readPersistedScope()` with localStorage using `stigmer:library:{type}:scope` keys (same convention as web)
- Wrapped scope setter in `useCallback` with `localStorage.setItem`
- SSR guard from web's `readPersistedScope` intentionally omitted (desktop runs entirely in Tauri webview — no dead code)

**MCP server list page** additionally:
- Imported `McpServerConnectDialog` from `@stigmer/react`
- Added `connectTarget` state and `renderItemAction` prop with per-card "+" connect button
- Rendered `McpServerConnectDialog` controlled by `connectTarget` open/close state

**Detail pages** (`AgentDetailPage.tsx`, `SkillDetailPage.tsx`, `McpServerDetailPage.tsx`):
- Added `resourceId` state, captured from `onResourceLoad({ name, id })` (previously only destructured `name`)
- Called `useUpdateVisibility(kind, resourceId)` from `@stigmer/react`
- Passed `onVisibilityChange` and `isVisibilityPending` to SDK DetailView components
- SDK DetailViews already support these props — when provided, they render an interactive `VisibilityToggle` with inline confirmation for public transitions

**Agent detail page** additionally:
- Added Edit `Link` navigating to `/?draft=agent&editOrg=${org}&editSlug=${slug}`
- Desktop `SessionLauncher` already parses `editOrg`/`editSlug` params via `parseDraftParams`

## Benefits

- Desktop users can now manage resource visibility, create new resources, and connect MCP servers without switching to the web console
- Scope preference persists across page navigation and app restarts — consistent with web behavior and shared via same localStorage keys
- Six files changed, 195 insertions, 54 deletions — small, focused, reviewable diff
- Zero SDK changes validates the SDK-first architecture: features built once in `@stigmer/react` are trivially adoptable by new consumers

## Impact

- **Desktop users**: Full library management parity with web — browse, search, scope, create, edit, connect, and toggle visibility all work
- **Codebase**: No new abstractions or components introduced; follows established DD-002 (console is a thin shell) and DD-004 (zero framework deps in SDK) patterns
- **Project**: Closes the last identified feature gaps from the T02 duplication audit; remaining work is T03 (web migration sweep) and visual testing

## Related Work

- T01: SDK Extraction (sessions 1-6) — extracted OrgProvider, useOrgGate, OrgSwitcher, settings nav, UserMenu to `@stigmer/react`
- T02: Desktop Shell Rebuild (session 7) — built sidebar, settings, breadcrumbs, extracted 9 settings sections and LibraryBreadcrumbContext to SDK
- Session 8: Native macOS app menu bar

---

**Status**: Production Ready
**Timeline**: Single session (~15 minutes implementation + verification)
