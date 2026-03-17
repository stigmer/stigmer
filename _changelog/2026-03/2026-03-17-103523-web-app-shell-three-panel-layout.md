# Web App Shell: Three-Panel Layout

**Date**: March 17, 2026

## Summary

Built the foundational three-panel application shell for the session-first web console. The shell provides a 48px header, a toggle-visibility sidebar (280px), a flexible main content area, and a collapsible right context panel (320px). This is the structural skeleton that all subsequent UI work (session launcher, active session view, sidebar recents) plugs into.

## Problem Statement

After the T01.3 web UI teardown, the console had zero layout infrastructure -- just a bare provider tree wrapping a placeholder page. The session-first UX requires a three-panel layout inspired by modern chat UIs (Claude, ChatGPT, Cursor) rather than the old dashboard-centric navigation sidebar.

### Pain Points

- No application shell after teardown -- children rendered directly inside `<Providers>` with no header, no sidebar, no structure
- The old layout used fixed positioning with margin offsets, which doesn't scale cleanly to three panels
- The old sidebar collapsed to an icon rail -- a pattern suited for navigation icons, not session lists
- No responsive behavior for the context panel or mobile sidebar overlay

## Solution

CSS Grid (vertical stacking) + Flexbox (horizontal panels) layout with `useSyncExternalStore`-based state management for panel visibility. Sidebar uses toggle-visibility (fully visible or fully hidden) instead of icon-rail collapse, matching the session-first mental model.

## Implementation Details

### New Files (8)

- **`use-layout-state.ts`** -- Two independent external stores. Sidebar visibility persists to `localStorage` with cross-tab sync via `StorageEvent`. Context panel visibility is session-scoped (in-memory, resets on reload).
- **`AppShell.tsx`** -- Grid (`grid-template-rows: 48px 1fr`) + Flex body container. Sidebar wrapper is inline on desktop, fixed overlay on mobile (`max-lg:fixed`) with backdrop and Escape-to-close. Context panel hidden below lg breakpoint.
- **`AppHeader.tsx`** -- 48px header: sidebar toggle (`PanelLeft` icon, `aria-expanded`/`aria-controls`), logo, OrgSwitcher, ThemeToggle, UserMenu.
- **`Sidebar.tsx`** -- "New Session" link (styled with `buttonVariants` since `@base-ui/react` Button lacks `asChild`), recents section with empty state placeholder.
- **`ContextPanel.tsx`** -- Collapsible right panel shell with close button and `children` slot. Uses sidebar design tokens for consistent panel styling.
- **`OrgSwitcher.tsx`** -- Recovered from git history. Org dropdown with loading/error/empty/single/multi states.
- **`ThemeToggle.tsx`** -- Recovered from git history. Light/system/dark radio group.
- **`UserMenu.tsx`** -- Recovered from git history. Avatar + dropdown with sign-out.

### Modified Files (2)

- **`layout.tsx`** -- Added `AppShell` import, wrapped `{children}` in `<AppShell>` inside `<Providers>`.
- **`page.tsx`** -- Changed `min-h-screen` to `h-full` to fit inside the shell's scrollable main area.

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Toggle visibility (not icon rail) | Sessions lack meaningful icons. Binary show/hide matches Claude/ChatGPT conventions (Jakob's Law). |
| 48px header (down from 56px) | Maximizes content area for conversation thread. Matches contemporary chat UI headers. |
| ThemePresetSelector deferred | Two theme controls violates Hick's Law. Only dark/light toggle for now. |
| Context panel toggle hidden in T01.4 | No content until T01.6. Empty toggle violates Nielsen heuristic #1. |
| `useSyncExternalStore` over React Context | No extra provider in tree, cross-tab sync for free, SSR-safe with `getServerSnapshot`. |
| Sub-components recovered from git | OrgSwitcher, ThemeToggle, UserMenu were clean and conceptually unchanged. Lower risk than rewriting. |

## Benefits

- The console has a complete, responsive application shell ready for content
- Three-panel layout handles sidebar toggle, context panel toggle, and mobile overlay with smooth transitions
- `prefers-reduced-motion` respected on all animations
- ARIA attributes on all interactive elements (`aria-expanded`, `aria-controls`, `aria-label`)
- Build and lint pass clean (zero errors, 2 static routes)

## Impact

- **Web console**: Goes from bare placeholder to fully structured three-panel shell
- **T01.5 (Session Launcher)**: Can now build inside the main content area with sidebar visible
- **T01.6 (Active Session View)**: Context panel shell is ready to receive execution metadata
- **T01.7 (Sidebar Recents)**: Sidebar structure with "New Session" + recents section is ready to populate

## Related Work

- Preceded by: T01.3 Web UI Teardown (`2026-03-17-100241`), React SDK Teardown (`2026-03-17-102117`)
- Followed by: T01.5 Web Session Launcher (next task)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
