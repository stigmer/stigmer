# Desktop Library Card Alignment Fix

**Date**: April 26, 2026

## Summary

Fixed the Library landing page card alignment in the desktop app where the three resource count cards (Agents, Skills, MCP Servers) collapsed to their minimum content width and floated as small boxes in the center of the content area. Root cause was a missing block formatting context wrapper that caused `mx-auto` to malfunction inside a flex column container.

## Problem Statement

The Library landing page in the desktop app displayed the three `ResourceCountCard` elements as narrow, content-sized boxes centered in a vast empty space, rather than stretching to fill the grid columns within a properly constrained and centered container.

### Pain Points

- Cards appeared as small ~300px-wide cluster instead of filling the ~850px content container
- Visual composition looked broken — cards "floating" with excessive dead space on all sides
- The same page rendered correctly in the web console, creating an inconsistency between platforms

## Solution

Added a `div.h-full.overflow-y-auto` wrapper to the desktop `LibraryLayout`, matching the pattern already established by `SettingsLayout` in the same codebase.

## Implementation Details

**Root cause**: The desktop `AppShell` renders its main content area as a `flex-direction: column` container (`main.flex.flex-col`). The `LibraryLayout` placed a `div.mx-auto.max-w-4xl` directly inside this flex column. In CSS flexbox, `margin-left: auto; margin-right: auto` on a flex child overrides the default `align-items: stretch` — instead of stretching to full width, the child collapses to its intrinsic content width and the auto margins center it. Since the grid inside uses `1fr` columns, which size based on available space, the entire grid collapsed to the minimum content width of the cards.

**Why Settings was unaffected**: `SettingsLayout` already wraps its `mx-auto` content in a `div.h-full.overflow-y-auto` block container. The outer div stretches to fill the flex parent (no `mx-auto`), and the inner `mx-auto` div operates within a block formatting context where `mx-auto` works as expected: width defaults to 100%, capped by `max-width`, centered by auto margins.

**Why web was unaffected**: The web `AppShell` wraps route children in an intermediate `div.min-w-0.flex-1.overflow-y-auto` block container before Library content renders, providing the same block formatting context.

**The fix** (`client-apps/desktop/src/pages/library/LibraryLayout.tsx`):

```tsx
<LibraryBreadcrumbProvider>
  <div className="h-full overflow-y-auto">       {/* ← added wrapper */}
    <div className="mx-auto max-w-4xl px-6 py-8">
      <LibraryBreadcrumb />
      <Outlet />
    </div>
  </div>
</LibraryBreadcrumbProvider>
```

## Benefits

- Cards now stretch to fill their grid columns within the `max-w-4xl` container, matching the web console appearance
- Library content scrolls vertically when it exceeds the viewport (list pages with many items, detail pages with long content)
- Follows the established `SettingsLayout` pattern — no new abstractions introduced
- One file, one wrapper div — minimal, targeted fix

## Impact

- **Desktop users**: Library landing page now displays correctly with properly sized, aligned resource count cards
- **Codebase**: Zero SDK changes; the `ResourceCountCard` component was correct — the issue was purely in the desktop app's layout wrapper
- **Web app**: Unaffected (already correct)

## Related Work

- Desktop Library Feature Parity (2026-04-26) — wired SDK components into desktop library pages
- Desktop-Web UX Parity (2026-04-26) — broader initiative to align desktop and web experiences

---

**Status**: Production Ready
**Timeline**: Single targeted fix
