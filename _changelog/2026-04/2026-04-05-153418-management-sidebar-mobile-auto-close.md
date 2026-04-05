# Management Sidebar: Mobile Auto-Close on Navigate

**Date**: April 5, 2026

## Summary

Added auto-close behavior for the mobile sidebar overlay so it dismisses when the user navigates via ManagementSidebar links. Extracted the Tailwind `lg` breakpoint into a named constant and made the settings layout padding responsive for small screens.

## Problem Statement

When using the ManagementSidebar on a mobile viewport (< 1024px), the sidebar renders as a fixed overlay with a backdrop. Tapping a nav link (Members, API Keys, Environments, or Back to Sessions) navigated to the correct page, but the sidebar stayed open, forcing the user to manually dismiss it before seeing the destination content. This created unnecessary friction on every navigation.

### Pain Points

- Every mobile nav tap required a second action (tap backdrop or press Escape) to see the page
- Inconsistent with standard mobile drawer patterns (e.g., Cursor's sidebar, Material UI drawers, iOS navigation) that auto-dismiss on selection
- The settings layout used fixed padding that was slightly tight on very small screens (375px)

## Solution

A single `useEffect` in `AppShell.tsx` keyed on `pathname` that checks viewport width and closes the sidebar when below the `lg` breakpoint. This is a centralized fix — no per-link wiring needed. Future nav links in either sidebar get the behavior automatically.

## Implementation Details

**`use-layout-state.tsx`**: Exported `LG_BREAKPOINT = 1024` constant, co-located with the `useSidebarOpen()` hook. Replaces the magic number that was already used in the Escape key handler.

**`AppShell.tsx`**: Added a `useEffect` with `[pathname]` dependency that auto-closes the sidebar on mobile. The `sidebar` object is intentionally excluded from the dependency array (with an ESLint suppression) to prevent the effect from re-firing when the sidebar opens/closes — which would immediately close the sidebar after the user opens it. Also updated the existing Escape key handler to use `LG_BREAKPOINT`.

**`settings/layout.tsx`**: Changed padding from `px-6 py-8` to `px-4 py-6 sm:px-6 sm:py-8` for better breathing room on small screens.

## Benefits

- Zero-friction mobile navigation in the management zone — tap a link, see the page
- Named constant eliminates magic number duplication and documents the breakpoint's role
- Centralized behavior that applies to both sidebars (management and session) without per-link code
- Responsive settings padding gives small screens slightly more content width

## Impact

- **Direct users on mobile**: ManagementSidebar navigation now matches standard mobile drawer UX patterns
- **Session Sidebar (bonus)**: Library and New Session links also auto-close the sidebar on mobile
- **Maintainers**: Future sidebar links get auto-close for free; no need to wire onClick handlers

## Related Work

- Part of the settings layout refactor project (`20260405.03.settings-layout-refactor`), Phase 5 (Polish & Edge Cases)
- Builds on the zone separation work from Sessions 1-2 (ManagementSidebar, AppShell zone detection)
- The session Sidebar's `pushState`-based navigation is a separate concern — `usePathname()` doesn't detect those changes

---

**Status**: ✅ Production Ready
**Timeline**: Session 4 of the settings layout refactor
