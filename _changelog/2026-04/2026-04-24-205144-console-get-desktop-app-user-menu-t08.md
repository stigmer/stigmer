# Console: "Get Desktop App" in User Menu (T08)

**Date**: April 24, 2026

## Summary

Added a "Get Desktop App" item to the Console's UserMenu dropdown, linking to the marketing site's `/download` page. This is the first external link in Console menus, establishing the visual pattern (muted `ArrowUpRight` indicator) for future external links in T09 and T10.

## Problem Statement

Users of the Stigmer Console had no in-app path to discover or install the Stigmer Desktop app. The download page existed on the marketing site (shipped in T06), and nav/footer links were wired (T07), but the Console — where users spend the most time — had zero awareness of the desktop app.

### Pain Points

- Console users who would benefit from the desktop app (local runners, deep links, tray management) had no way to discover it from within the Console.
- No external link pattern existed in Console menus, so there was no precedent to follow.

## Solution

Added a `DesktopAppItem` component to `UserMenu.tsx` that renders in both the local-mode (unauthenticated) and authenticated menu variants. Created a shared `external-links.ts` config file for Console-wide external URL constants.

## Implementation Details

### New file: `client-apps/web/src/config/external-links.ts`

Shared constant object (`EXTERNAL_LINKS`) with `website`, `download`, `github`, and `docs` URLs. Static across all deployments — intentionally not in `RuntimeConfig`, which is reserved for deployment-specific values. T09 and T10 will import from this same file.

### Modified: `client-apps/web/src/domain/_shared/layout/UserMenu.tsx`

- Added `DesktopAppItem` function component alongside existing `SettingsItem`.
- Uses `DropdownMenuItem` with the `render` prop for `<a>` composition — same pattern as `SettingsItem` uses for `<Link>`.
- `Monitor` icon (lucide-react) for the desktop app concept. `AppWindow` was avoided — already used for OAuth Apps in settings-nav.
- Muted `ArrowUpRight` icon (`size-3`) right-aligned as the external link indicator — standard web convention.
- `target="_blank"` + `rel="noopener noreferrer"` for security.
- Placed after Appearance submenu, before the separator and Sign out (authenticated) or as last item (local-mode).
- ESLint `stigmer/no-main-tokens-in-sidebar` exception on the `ArrowUpRight` — consistent with existing exceptions in `AppearanceSubmenu` for portaled dropdown content.

## Benefits

- Console users can now discover and access the desktop app download page from the user menu in both session and management sidebars.
- External link visual pattern (`ArrowUpRight` indicator) established for reuse in T09 and T10.
- Shared `external-links.ts` avoids URL scattering across component files.

## Impact

- **Console UI**: Both sidebar variants (session and management) show the new menu item.
- **No SDK changes**: DD-02 compliance — all promotion UI stays in `client-apps/web`.
- **No new dependencies**: Uses existing lucide-react icons and dropdown menu components.

## Related Work

- **T06** (`6e879ead7`): Marketing site `/download` page with platform detection.
- **T07** (`498522593`): Nav/footer wiring for download link on marketing site.
- **T09** (next): Contextual runner promotion in `RunnersSection`.
- **T10** (upcoming): Smart nudge banner in `AppShell`.
- **Project**: `20260424.01.desktop-app-promotion` — Phase B distribution and promotion.

---

**Status**: Production Ready
**Files changed**: 2 (1 new, 1 modified)
