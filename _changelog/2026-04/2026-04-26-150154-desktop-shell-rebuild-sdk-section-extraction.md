# Desktop App Shell Rebuild + SDK Settings Section Extraction

**Date**: April 26, 2026

## Summary

Rebuilt the Stigmer desktop app shell to match the web console's UX — adding OrgSwitcher, UserMenu, sidebar collapse, ManagementSidebar, settings landing page, library breadcrumbs, and all 11 settings pages. Simultaneously extracted 9 settings Section components and the LibraryBreadcrumbContext from the web console into `@stigmer/react`, eliminating duplication across both client apps.

## Problem Statement

The desktop app had significant UX gaps compared to the web console: no org switcher, no user menu, no sidebar collapse, no management sidebar for settings navigation, missing settings pages (6 of 11), and no library breadcrumbs. Additionally, the web console's settings Section components (orchestrating headings, descriptions, cloud guards, and CRUD flows) would need to be duplicated in the desktop app.

### Pain Points

- Desktop users had no way to switch organizations, toggle color mode, or access user settings
- Settings navigation required memorizing paths — no management sidebar or landing page
- 6 settings pages (invitations, identity providers, platform clients, OAuth apps, billing, usage) were completely missing
- Building the missing pages would duplicate ~800 lines of orchestration logic from the web console
- LibraryBreadcrumbContext was copy-pasted between both apps

## Solution

Two-pronged approach: (1) rebuild the desktop shell using SDK components extracted in T01, and (2) extract web console Section components into the SDK so both apps share identical settings views with zero duplication.

## Implementation Details

### Desktop Shell Rebuild
- `useSidebarOpen()` hook with `useSyncExternalStore` + localStorage for sidebar collapse
- `UserMenu.tsx` bridge mapping desktop auth/theme/routing to SDK `UserMenu` props
- `useColorModePreference()` hook persisting light/dark/system to localStorage
- `ManagementSidebar.tsx` consuming `SETTINGS_NAV_GROUPS` from SDK
- `AppShell.tsx` zone switching: `/settings` renders ManagementSidebar, else renders main Sidebar
- `SettingsLayout.tsx` with centered `max-w-3xl` container via `<Outlet />`
- `SettingsLanding.tsx` with nav group cards
- Library breadcrumbs with `LibraryBreadcrumb.tsx`, `LibraryLayout.tsx`, detail page `onResourceLoad` callbacks

### SDK Section Extraction
- Moved 9 Section components from `client-apps/web/src/domain/settings/` to `sdk/react/src/settings/`: ApiKeysSection, MembersSection, OrgProfileSection, EnvironmentsSection, InvitationsSection, IdentityProvidersSection, PlatformClientsSection, OAuthAppsSection, UsageSection
- Converted `@stigmer/react` imports to relative SDK-internal imports
- Added `ssoLoginBaseUrl` prop to `IdentityProvidersSection` for desktop portability
- Migrated web page files to import directly from `@stigmer/react`
- Desktop settings routes reference SDK sections directly in `routes.tsx` — no wrapper files needed
- Extracted `LibraryBreadcrumbContext` (provider + hooks) to `sdk/react/src/library/`

### What Stays App-Specific
- `SettingsRunners` (desktop): 408 lines of Tauri-specific runner management with local runner hooks, split-panel log viewer, and start dialog
- `RunnersSection` (web): Different implementation using `RunnerListPanel` + `useLaunchLocalRunner` + desktop download promo
- Billing: Coming-soon placeholder (inlined in desktop routes)

## Benefits

- **Zero duplication**: Both apps consume identical Section components from `@stigmer/react`
- **Net code reduction**: 50 files changed, ~800 lines deleted from web domain, desktop pages eliminated
- **Desktop feature parity**: All 11 settings pages, org switcher, user menu, sidebar collapse, management sidebar, library breadcrumbs
- **SDK-first**: Platform builders can now embed complete settings views (`<ApiKeysSection />`, `<MembersSection />`, etc.) into their products
- **Maintainability**: Bug fixes or feature additions to Section components automatically apply to both web and desktop

## Impact

- **Desktop users**: Full settings experience matching the web console
- **Platform builders**: 9 new drop-in settings Section components available from `@stigmer/react`
- **Maintainers**: Single source of truth for settings UI — no more cross-app synchronization

## Related Work

- T01 SDK extraction sessions (OrgProvider, useOrgGate, OrgSwitcher, UserMenu, SETTINGS_NAV_GROUPS)
- Web SDK architecture standards (DD-001 through DD-008)
- Desktop invisible window fix (session 3)

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
