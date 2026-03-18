# Headerless Sidebar-Driven Layout

**Date**: March 17, 2026

## Summary

Removed the top header bar entirely and moved all controls (org switcher, theme toggle, user menu) into the sidebar, matching the Claude Cowork / Cursor layout pattern. The main content area now gets full viewport height, and the sidebar serves as the single navigation surface.

## Problem Statement

The initial three-panel layout (T01.4) used a 48px header bar for brand identity, org switching, theme toggle, and user menu. After visual testing:

### Pain Points

- The header consumed vertical space that could go to the main content (session thread)
- The sidebar border was invisible in light mode due to theme token contrast issues (`--stgm-sidebar-border` at `oklch(0.922)` vs sidebar bg at `oklch(0.985)`)
- The theme toggle as a standalone three-button widget added visual noise to the header
- The OrgSwitcher used a native `<select>` element with limited clickable area and inconsistent interaction patterns
- The overall layout felt conventional rather than focused — modern AI tools (Claude, Cursor) have moved to headerless sidebar-driven layouts

## Solution

Adopted a headerless layout where the sidebar owns all navigation and controls:
- **Top of sidebar**: Collapse toggle + OrgSwitcher
- **Middle**: New Session link + scrollable Recents
- **Bottom**: UserMenu with nested Appearance submenu for theme switching

## Implementation Details

### Files Deleted
- `AppHeader.tsx` — header concept fully removed
- `ThemeToggle.tsx` — standalone widget replaced by submenu inside UserMenu

### Files Modified
- **`AppShell.tsx`**: Converted from CSS Grid (`gridTemplateRows: 48px 1fr`) to plain `flex h-screen`. Sidebar uses single `w-70`/`w-0` toggle for all screen sizes (previously desktop was always-visible). Added floating `PanelLeft` reopen button when sidebar is collapsed. Border changed from `border-sidebar-border` to `border-foreground/10` for guaranteed visibility.
- **`Sidebar.tsx`**: Added top row with collapse toggle (PanelLeft icon button) + OrgSwitcher. Added bottom section with UserMenu separated by `border-t border-foreground/10`. Imports `useSidebarOpen` for toggle control.
- **`UserMenu.tsx`**: Added `AppearanceSubmenu` component using `DropdownMenuSub` + `DropdownMenuRadioGroup`. Both local-mode and authenticated states render as full-width dropdown triggers with `ChevronsUpDown` indicator. Dropdown opens upward (`side="top"`). Theme label shown inline on submenu trigger.
- **`OrgSwitcher.tsx`**: Replaced native `<select>` with `DropdownMenu` + `DropdownMenuRadioGroup` + `DropdownMenuRadioItem`. Full-width clickable trigger with Building2 icon + org name + chevrons. Single-org case renders as static display without dropdown.

### Border Visibility Fix
The `--stgm-sidebar-border` token resolves to `oklch(0.922 0 0)` in light mode, which has only ~6% lightness difference from the sidebar background (`oklch(0.985 0 0)`) — effectively invisible. Replaced with `border-foreground/10` which uses 10% opacity of the foreground color, ensuring a visible but subtle border in both light and dark themes.

## Benefits

- **More content area**: Full viewport height for the session thread — no 48px header overhead
- **Consistent interaction**: All navigation and controls are in one surface (sidebar), reducing cognitive load
- **Visible separation**: `border-foreground/10` provides reliable cross-theme border contrast
- **Better org switching**: DropdownMenu with radio items replaces native `<select>` — full-width clickable area, active org shown with checkmark
- **Cleaner theme control**: Appearance submenu in user dropdown reduces always-visible UI elements

## Impact

- **Users**: Cleaner, more focused layout with maximum content area for sessions
- **Developers**: Simpler layout architecture (plain Flex vs Grid+Flex), two fewer components to maintain
- **Design system**: Established `border-foreground/10` as the reliable border strategy when sidebar-specific tokens lack contrast

## Related Work

- T01.4 changelog: `2026-03-17-103523-web-app-shell-three-panel-layout.md` (initial three-panel layout)
- Part of `20260317.01.session-first-web-ux` project, refining T01.4's layout based on user feedback

---

**Status**: Production Ready
**Timeline**: ~1 hour (iterative refinement based on visual testing)
