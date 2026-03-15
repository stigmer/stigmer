# Web Layout Overhaul: Global Header, Collapsible Sidebar, Breadcrumbs

**Date**: March 15, 2026

## Summary

Implemented the Phase 6 layout overhaul for Stigmer Web: a full-width global header bar, collapsible sidebar with localStorage persistence, and a reusable breadcrumb system. This replaces the ad-hoc navigation patterns (ArrowLeft back-links) with a cohesive layout shell that follows platform conventions (Planton, Linear) and establishes the structural foundation for all future views.

## Problem Statement

The web console lacked a global header entirely — there was no persistent location for user identity, organization context, theme switching, or future additions like global search and notifications. The sidebar contained too many responsibilities (logo, org switcher, navigation, theme toggle) and had no collapse mechanism. Detail pages used inconsistent ArrowLeft back-links instead of hierarchical breadcrumbs.

### Pain Points

- No global header — user profile, org context, and theme toggle buried in sidebar (Nielsen #1: Visibility of System Status)
- No breadcrumbs — detail pages used manual ArrowLeft links with no hierarchy context (Nielsen #3: User Control and Freedom)
- Sidebar not collapsible — wastes horizontal space for power users on smaller screens (Fitts's Law, Nielsen #7: Flexibility and Efficiency)
- OrgSwitcher, ThemeToggle, and logo crowded the sidebar, reducing space for navigation items

## Solution

Three-part layout restructuring:

1. **Global Header** (`AppHeader`): Full-width fixed bar above the sidebar containing logo, OrgSwitcher, spacer, ThemeToggle, and UserMenu. Z-index 40 ensures it stays above all content including the sidebar.

2. **Collapsible Sidebar**: Sidebar starts below the header and accepts `isCollapsed`/`onToggle` props. Collapse state persists in `localStorage` via `useSyncExternalStore` (SSR-safe, avoids hydration mismatch). Collapsed width is 60px (icons only), expanded is 240px. Smooth CSS transition on width changes.

3. **Breadcrumb System**: Reusable `Breadcrumb` component with accessibility (`aria-label`, `aria-current="page"`). Integrated into `TopBar` via optional `breadcrumbs` prop. All 4 detail pages updated to use breadcrumbs instead of ArrowLeft links.

## Implementation Details

### New Components (5 files)

- **`AppHeader.tsx`**: Fixed header bar at `height: 56px`, `z-40`. Contains logo mark ("S" badge), "Stigmer" text, vertical divider, `OrgSwitcher`, flex spacer, `ThemeToggle`, `UserMenu`.

- **`UserMenu.tsx`**: Two modes based on auth state:
  - Disabled auth: static `User` icon, no dropdown
  - OIDC: initial-letter avatar with `DropdownMenu` showing email and sign-out action
  - Uses shadcn `DropdownMenu` backed by `@base-ui/react/menu`

- **`Breadcrumb.tsx`**: Props: `items: Array<{ label: string; href?: string }>`. ChevronRight separators. Last item rendered as `<span>` with `aria-current="page"`, earlier items as `<Link>` elements.

- **`useSidebarCollapse.ts`**: Uses `useSyncExternalStore` to read from `localStorage` without triggering cascading renders. Server snapshot returns `false` (expanded). Toggle dispatches a synthetic `StorageEvent` to notify all subscribers.

- **`dropdown-menu.tsx`**: shadcn component installed via `shadcn@latest add dropdown-menu`.

### Modified Components (4 files)

- **`AppShell.tsx`**: Restructured to render `AppHeader` + `Sidebar` + `<main>`. Main content offset by `HEADER_HEIGHT` (top) and dynamic sidebar width (left). Smooth `transition-[margin-left]` on collapse.

- **`Sidebar.tsx`**: Removed logo, OrgSwitcher, ThemeToggle (all moved to header). Added collapse toggle button at bottom (PanelLeftClose/PanelLeftOpen icons). Section headers hidden when collapsed. `title` attribute on nav links when collapsed for hover tooltip. Top offset by `HEADER_HEIGHT`.

- **`TopBar.tsx`**: Added optional `breadcrumbs` prop. When provided, renders `Breadcrumb` above the title/description area. Fully backward compatible.

- **`OrgSwitcher.tsx`**: Padding adjusted for header context (removed sidebar-specific spacing that assumed full-width container).

### Detail Pages Updated (4 files)

- `AgentDetailPage.tsx`: ArrowLeft → TopBar with breadcrumbs (Agents > Agent Name)
- `SkillDetailPage.tsx`: ArrowLeft → TopBar with breadcrumbs (Skills > Skill Name)
- `McpServerDetailPage.tsx`: ArrowLeft → TopBar with breadcrumbs (MCP Servers > Server Name)
- `SessionDetailPage.tsx`: ArrowLeft → inline Breadcrumb (chat-specific layout doesn't use TopBar)

### Technical Decision: `useSyncExternalStore`

The initial implementation used `useState` + `useEffect` to read `localStorage` on mount. ESLint's `react-hooks/set-state-in-effect` rule flagged this — the same rule that caught the ThemeToggle issue in Session 2. Refactored to `useSyncExternalStore`, which is React's canonical API for syncing with external data sources in an SSR-safe manner.

## Benefits

- **User orientation**: Global header provides persistent visibility of org context, user identity, and theme — always visible regardless of scroll or page
- **Horizontal space recovery**: Sidebar collapse gives power users ~180px of additional content width
- **Navigation clarity**: Breadcrumbs replace inconsistent back-links with hierarchical context (e.g., "Skills > My Skill" instead of "← Back to Skills")
- **Consistency**: Layout now follows the same header-above-sidebar pattern as Planton Web and Linear
- **Foundation for future**: Header has natural slots for Cmd+K search and notifications (deferred to separate tasks)

## Impact

- **13 files** total (5 new, 8 modified)
- All existing pages continue to work — `TopBar` breadcrumbs prop is optional
- Sidebar collapse state persists across sessions via `localStorage`
- No new runtime dependencies beyond `@base-ui/react/menu` (already in dependency tree via shadcn)

## Related Work

- [Web Navigation IA Design](2026-03-15-160249-web-navigation-ia-design-and-catalog-removal.md) — established the sidebar taxonomy this layout implements
- [Web Visual Identity & Theme System](2026-03-15-153808-web-visual-identity-theme-system.md) — brand colors and dark mode that the header uses
- [Web Error Handling Framework](2026-03-15-172120-web-error-handling-framework.md) — McpServerDetailPage also adopted ErrorMessage during breadcrumb integration

---

**Status**: Production Ready
**Project**: 20260315.02.web-architecture-alignment (T11)
