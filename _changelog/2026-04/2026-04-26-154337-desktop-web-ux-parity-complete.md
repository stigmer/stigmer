# Desktop-Web UX Parity — Project Complete

**Date**: April 26, 2026

## Summary

Completed the desktop-web UX parity project across 10 sessions, bringing the Stigmer desktop app to full feature parity with the web console. Extracted 5 shared app shell components and 9 settings sections into `@stigmer/react`, rebuilt the desktop app shell from scratch, and verified that both apps now present an identical experience to users while sharing a single SDK-based codebase for all feature logic.

## Problem Statement

The Stigmer desktop app (Tauri v2) and web console (Next.js 16) had significant UX gaps and duplicated code. The desktop was missing core features that users expected from the web experience, and both apps maintained their own independent implementations of identical domain logic.

### Pain Points

- Desktop lacked org switcher, user menu, sidebar collapse, settings surface, and library breadcrumbs
- OrgProvider, OrgSwitcher, UserMenu, and settings navigation were implemented independently in both apps
- 9 settings section components existed as near-identical copies in each app
- No shared org gate behavior hook — both apps maintained their own provisioning state machines
- Library pages had feature gaps (no page headers, no scope persistence, no connect dialog, no visibility toggle)

## Solution

Three-phase approach following the established SDK-first architecture (DD-001 through DD-008):

1. **T01 — SDK Extraction**: Extract shared app shell components from both apps into `@stigmer/react`
2. **T02 — Desktop Shell Rebuild**: Rebuild the desktop app shell using the extracted SDK components, adding missing features
3. **T03 — Web App Migration**: Clean up the web app, verify parity, remove dead code

## Implementation Details

### T01: SDK Extraction (Sessions 1–6)

Extracted 5 components to `@stigmer/react`:

| Component | SDK Path | What It Does |
|-----------|----------|-------------|
| `OrgProvider` + `useOrg` + `useActiveOrgSlug` | `organization/OrgProvider.tsx` | Org list management, active org state, localStorage persistence |
| `useOrgGate` | `organization/useOrgGate.ts` | Headless provisioning state machine (loading/provisioning/error/no-orgs/ready) |
| `OrgSwitcher` | `organization/OrgSwitcher.tsx` | Dropdown for switching orgs, creating new orgs |
| `SETTINGS_NAV_GROUPS` | `settings/settings-nav.ts` | Settings navigation data (groups, items, icons, hrefs) |
| `UserMenu` | `user/UserMenu.tsx` | User avatar, color mode toggle, settings link, sign out |

Key design decisions:
- Callback-based props for framework independence (`onOrgChanged`, `onSettingsClick`, `onSignOut`)
- Controlled `colorMode` + `onColorModeChange` on UserMenu (SDK's `useColorMode()` is read-only)
- `extraItems` slot on UserMenu for app-specific menu items
- SDK-internal Menu primitives (`sdk/react/src/internal/menu.tsx`) for consistent styled wrappers

### T02: Desktop Shell Rebuild (Sessions 7–9)

Built the complete desktop app shell:
- Sidebar with OrgSwitcher, session recents, collapse toggle, UserMenu, version footer
- ManagementSidebar with `SETTINGS_NAV_GROUPS` navigation
- 11 settings pages (9 SDK sections + Tauri runner management + billing placeholder)
- Settings landing page, SettingsLayout with centered container
- Library breadcrumbs with resource name override
- Native macOS app menu bar (About, Check for Updates, Edit, Window)
- Color mode toggle persisted to localStorage

Extracted 9 settings sections to SDK (`sdk/react/src/settings/`):
ApiKeysSection, MembersSection, OrgProfileSection, EnvironmentsSection, InvitationsSection, IdentityProvidersSection, PlatformClientsSection, OAuthAppsSection, UsageSection

Closed all library feature gaps:
- Page headers with title, description, "Add" action
- Scope toggle with localStorage persistence (`stigmer:library:{type}:scope`)
- MCP server connect dialog with per-card connect button
- Interactive visibility toggle on detail pages
- Agent edit button

### T03: Web App Migration (Session 10)

- Deleted 6 dead `_shared/ui/` files (badge, card, dialog, table, collapsible, error-message)
- Verified cross-app feature parity across all library and settings pages
- Confirmed import hygiene: zero redundant SDK re-exports remain
- All verification targets pass: SDK lint + typecheck, web lint, desktop lint + typecheck + cargo check

## Benefits

- **User experience**: Identical feature surface across desktop and web — no more UX gaps
- **Code deduplication**: 5 shared components + 9 settings sections now live in a single SDK location
- **Maintainability**: Feature changes to org management, settings, or library only need to happen once in the SDK
- **Platform builder DX**: OrgProvider, OrgSwitcher, UserMenu, and settings sections are now available to platform builders embedding Stigmer into their products
- **Desktop completeness**: Native macOS menu bar, color mode toggle, full settings surface, library breadcrumbs

## Impact

- **SDK (`@stigmer/react`)**: 15+ new exports (5 app shell components, 9 settings sections, LibraryBreadcrumbContext)
- **Desktop app**: Rebuilt shell with full feature parity (sidebar, settings, library, native menu)
- **Web app**: Migrated to SDK components, 6 dead files removed, clean import hygiene
- **Both apps**: Structurally identical library and settings pages, differing only in framework-specific routing

## Related Work

- [OrgProvider SDK Extraction](2026-04-26-122508-orgprovider-sdk-extraction.md)
- [useOrgGate SDK Extraction](2026-04-26-124022-useorggate-sdk-extraction.md)
- [OrgSwitcher SDK Extraction](2026-04-26-130535-extract-orgswitcher-to-sdk.md)
- [Settings Nav SDK Extraction](2026-04-26-133359-settings-nav-sdk-extraction.md)
- [UserMenu SDK Extraction](2026-04-26-135916-extract-usermenu-to-sdk.md)
- [Desktop Shell Rebuild](2026-04-26-150154-desktop-shell-rebuild-sdk-section-extraction.md)
- [Native App Menu Bar](2026-04-26-150818-desktop-native-app-menu-bar.md)
- [Library Feature Parity](2026-04-26-151832-desktop-library-feature-parity.md)

---

**Status**: Production Ready
**Timeline**: 10 sessions across 1 day (April 26, 2026)
