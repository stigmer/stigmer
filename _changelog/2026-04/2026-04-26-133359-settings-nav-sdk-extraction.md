# Extract Settings Navigation to `@stigmer/react`

**Date**: April 26, 2026

## Summary

Moved `SETTINGS_NAV_GROUPS`, `SettingsNavItem`, and `SettingsNavGroup` from the web console's local layout module into `@stigmer/react` as shared SDK exports. Both client apps can now consume the canonical settings navigation structure from a single source. Also fixed a pre-existing dependency hygiene gap by declaring `lucide-react` as a peer dependency of the SDK.

## Problem Statement

The settings navigation data — the constant array that defines groups, labels, icons, and href paths for the management sidebar and settings landing page — lived inside the web console at `client-apps/web/src/domain/_shared/layout/settings-nav.ts`. This violated DD-001 (SDK-first development): the desktop app needed identical navigation structure for its management sidebar (T02), but had no shared source to import from.

### Pain Points

- Desktop app would have to duplicate the settings nav structure or import from web (a boundary violation)
- Any settings page addition required updating a file that only the web console owned
- `lucide-react` was imported by the SDK in two files (`OrgSwitcher.tsx`, `internal/menu.tsx`) without being declared in `package.json` — a broken contract for external platform builders

## Solution

Pure code-motion extraction: copy the 75-line source file verbatim into a new `sdk/react/src/settings/` domain directory, update barrel exports, migrate both web consumers, and delete the original.

## Implementation Details

- **New SDK files**: `sdk/react/src/settings/settings-nav.ts` (types + constant), `sdk/react/src/settings/index.ts` (barrel)
- **SDK barrel update**: Added `SETTINGS_NAV_GROUPS`, `SettingsNavItem`, `SettingsNavGroup` exports to `sdk/react/src/index.ts`
- **Dependency fix**: Added `lucide-react: ">=0.400.0"` as a non-optional peer dependency in `sdk/react/package.json`
- **Consumer migration**: Updated imports in `client-apps/web/src/app/settings/page.tsx` and `client-apps/web/src/domain/_shared/layout/ManagementSidebar.tsx`
- **Deleted**: `client-apps/web/src/domain/_shared/layout/settings-nav.ts`

## Benefits

- Single source of truth for settings navigation across all Stigmer client apps
- Desktop app (T02) can import `SETTINGS_NAV_GROUPS` from `@stigmer/react` without duplication
- Platform builders who embed Stigmer settings components get the canonical nav structure for free
- `lucide-react` peer dependency closes an existing gap — external SDK consumers will no longer hit missing-module errors

## Impact

- **SDK consumers**: New exports available (`SETTINGS_NAV_GROUPS`, `SettingsNavItem`, `SettingsNavGroup`); `lucide-react` now listed as a required peer dependency
- **Web console**: Import path change only — zero behavioral change
- **Desktop app**: Unaffected in this change; T02 will wire these exports into the desktop management sidebar

## Related Work

- Part of T01 (SDK Extraction) in the desktop-web-ux-parity project
- Follows T01-A (OrgProvider), T01-B (useOrgGate), T01-C (OrgSwitcher)
- Precedes T01-E (UserMenu extraction) and T02 (Desktop App Shell Rebuild)

---

**Status**: Production Ready
**Timeline**: ~15 minutes
