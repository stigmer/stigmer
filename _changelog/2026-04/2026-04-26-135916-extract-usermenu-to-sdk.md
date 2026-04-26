# Extract UserMenu to @stigmer/react

**Date**: April 26, 2026

## Summary

Extracted the UserMenu component from the web Console into `@stigmer/react`, completing the final subtask (T01-E) of the SDK extraction phase. The 234-line monolithic component was replaced with a framework-agnostic SDK component and a 45-line Console bridge, eliminating `next-themes` and `next/link` dependencies from the shared component while introducing a controlled color mode API that any host application can integrate.

## Problem Statement

The web Console's `UserMenu` was a tightly coupled component that mixed platform-agnostic behavior (user avatar, color scheme switching, menu structure) with Console-specific concerns (`next-themes`, `next/link`, `useAuth`, preset picker, desktop download trigger). This violated DD-001 (SDK-first development) and DD-004 (zero framework deps in SDK), and made the component unusable in the desktop app or by platform builders.

### Pain Points

- UserMenu imported from `next-themes` and `next/link` — framework-specific, impossible to embed in non-Next.js environments
- Color scheme switching was coupled to `next-themes` `setTheme()` — the SDK's `useColorMode()` is read-only with no mutation surface
- Desktop app had no user menu at all — no shared component to consume
- Preset picker and color scheme were nested in a submenu, adding unnecessary interaction depth for 3 radio items

## Solution

Extracted the UserMenu to `sdk/react/src/user/UserMenu.tsx` with a callback-based props API following the established `OrgSwitcher` pattern. The web's `UserMenu.tsx` was rewritten as a thin Console bridge that maps `next-themes` and `useAuth` to the SDK component's props.

## Implementation Details

**SDK component (`sdk/react/src/user/UserMenu.tsx`)**:
- `UserMenuProps` interface: `user`, `colorMode`, `onColorModeChange`, `onSettingsClick`, `onSignOut`, `extraItems`, `className`
- Uses SDK-internal Menu primitives from `internal/menu.tsx` (reuses the same components as `OrgSwitcher`)
- Flattened color scheme: Light/Dark/System as radio items directly in the menu body with a `MenuLabel` section header — no submenu
- Sidebar-context trigger tokens, popover-context dropdown tokens per DD-005
- Optional sections: each menu section only renders when its callback prop is provided

**New internal menu primitives (`sdk/react/src/internal/menu.tsx`)**:
- `MenuGroup` — semantic grouping wrapper with `role="group"`
- `MenuLabel` — styled section header (uppercase, muted-foreground, tracking-wider)

**Console bridge (`client-apps/web/src/domain/_shared/layout/UserMenu.tsx`)**:
- Maps `useTheme()` → `colorMode` + `onColorModeChange`
- Maps `useAuth()` → `user` + `onSignOut`
- Maps `useRouter().push("/settings")` → `onSettingsClick`
- Renders web-only `DesktopAppItem` via `extraItems` slot
- Preserves existing import paths — zero changes to `Sidebar.tsx` and `ManagementSidebar.tsx`

**Architectural surprise resolved**: `useColorMode()` is read-only (returns resolved `"light"` | `"dark"`, no setter). Rather than modifying the SDK provider API, the UserMenu uses controlled `colorMode` + `onColorModeChange` props, consistent with the callback-based pattern established by `OrgSwitcher.onOrgChanged`.

## Benefits

- **Desktop parity**: The desktop app can now render the same UserMenu component, passing its own color mode state and routing callbacks
- **Platform builder ready**: External consumers can embed a user menu with `<UserMenu user={...} onSignOut={...} />` — no framework coupling
- **234 → 45 lines** in the Console: the web's UserMenu went from a full implementation to a thin bridge
- **Simpler UX**: Flattened color scheme (3 radio items in menu body) vs. nested submenu reduces interaction depth per Hick's Law
- **Preset picker removed**: Simplifies the menu; presets can be reintroduced later in a dedicated Appearance settings page if needed

## Impact

- **T01 subtask completion**: T01-E is the final extraction subtask. T01 (SDK Extraction) is now complete — OrgProvider, useOrgGate, OrgSwitcher, settings nav, and UserMenu are all in `@stigmer/react`
- **T02 unblocked**: The desktop app shell rebuild can now consume all extracted SDK components
- **Web Console**: Functionally equivalent user menu with smaller footprint; preset switching removed per plan

## Related Work

- T01-A: OrgProvider extraction (`2026-04-26-122508`)
- T01-B: useOrgGate extraction (`2026-04-26-124022`)
- T01-C: OrgSwitcher extraction (`2026-04-26-130535`)
- T01-D: Settings nav extraction (`2026-04-26-133359`)
- Desktop-web UX parity project: `_projects/2026-04/20260426.01.desktop-web-ux-parity/`

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (session 6 of desktop-web-ux-parity project)
