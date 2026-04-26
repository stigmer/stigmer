# Task T01: SDK Extraction — Shared App Shell Components

**Created**: 2026-04-26
**Status**: PENDING REVIEW
**Type**: Refactoring / SDK extraction

> This plan requires your review before execution.

## Objective

Extract duplicated app shell components (OrgProvider, OrgGate logic, OrgSwitcher, UserMenu, settings navigation data) from both `client-apps/web` and `client-apps/desktop` into `@stigmer/react`, establishing the shared foundation that both apps will consume.

## Background

The web and desktop apps maintain near-identical implementations of org context management, org gate provisioning logic, org switching, user menu, and settings navigation configuration. This violates DD-001 (SDK-first development) and creates maintenance burden. These components have zero framework-specific dependencies in their core logic — only the routing glue differs.

## Prerequisite Context

All design decisions were resolved during the planning session:

- **No preset picker** in UserMenu — color mode switching only (light/dark/system)
- **Cloud-only settings pages** shown in both apps, using `useResourceAvailable()` + `CloudFeatureNotice`
- **Sidebar collapse** implemented for parity
- **Library breadcrumbs** included (handled in T02)
- **`@base-ui/react`** adopted by desktop as explicit dependency

## Task Breakdown

### T01-A: Extract `OrgProvider` + `useOrg()` + `useActiveOrgSlug()` to SDK

**Source files (near-identical):**
- `client-apps/desktop/src/org/OrgProvider.tsx`
- `client-apps/web/src/domain/_shared/org/org-context.tsx`

**Target:** `sdk/react/src/organization/OrgProvider.tsx`

**What to extract:**
- `OrgProvider` component — uses `useStigmer()` to call `stigmer.organization.findMyOrganizations()`, manages org list + active org state, persists to `localStorage` key `stigmer:activeOrgSlug`
- `useOrg()` hook — returns `{ orgs, activeOrg, setActiveOrg, isLoading, error, retry, refresh }`
- `useActiveOrgSlug()` convenience hook

**Key decisions:**
- The provider uses only `useStigmer()` from the SDK — zero framework deps
- Both implementations are already identical (same localStorage key, same API call, same state management)
- Add to barrel export in `sdk/react/src/index.ts`

**After extraction:**
- Delete `client-apps/desktop/src/org/OrgProvider.tsx`
- Update desktop imports to `import { OrgProvider, useOrg, useActiveOrgSlug } from "@stigmer/react"`
- Delete `client-apps/web/src/domain/_shared/org/org-context.tsx`
- Update web imports similarly

### T01-B: Extract `useOrgGate()` behavior hook to SDK

**Source files:**
- `client-apps/desktop/src/org/OrgGate.tsx`
- `client-apps/web/src/domain/_shared/org/OrgGate.tsx`

**Target:** `sdk/react/src/organization/useOrgGate.ts`

**What to extract:**
- A headless behavior hook that encapsulates the provisioning state machine:
  - States: `loading` | `provisioning` | `error` | `no-orgs` | `ready`
  - Provisioning poll logic (2s interval, 10s timeout)
  - Error handling and retry
- Hook signature: `useOrgGate(options: { isBypassed: boolean; isOidcMode: boolean }) => OrgGateState`

**What stays in client apps:**
- The `isBypassed` routing check (web uses `usePathname()`, desktop uses `useLocation()`)
- The `isOidcMode` detection (web reads `getRuntimeConfig().authMode`, desktop checks `user !== null`)
- All rendering (loading spinner, provisioning screen, error screen, onboarding form) — these are app-specific with different styling/layout

**After extraction:**
- Both apps' `OrgGate` components become thin renderers: compute `isBypassed` + `isOidcMode` locally, call `useOrgGate()`, render based on returned state

### T01-C: Extract `OrgSwitcher` component to SDK

**Source file:** `client-apps/web/src/domain/_shared/layout/OrgSwitcher.tsx`

**Target:** `sdk/react/src/organization/OrgSwitcher.tsx`

**What to extract:**
- The dropdown component that shows active org (name + slug), lists personal vs team orgs with icons, and allows switching + creating new orgs
- Uses `useOrg()` (now from SDK), `CreateOrganizationForm` (already in SDK)

**Framework abstraction:**
- Replace web's `DropdownMenu*` imports (from `@/domain/_shared/ui/dropdown-menu`) with `@base-ui/react` Menu primitives directly (the web's dropdown-menu.tsx is itself a thin wrapper over `@base-ui/react`)
- Replace web's `Dialog*` imports with `@base-ui/react` Dialog primitives
- No routing dependency — org switching is handled via `setActiveOrg()` from context + optional `onOrgChanged` callback prop

### T01-D: Move `SETTINGS_NAV_GROUPS` to SDK

**Source file:** `client-apps/web/src/domain/_shared/layout/settings-nav.ts`

**Target:** `sdk/react/src/settings/settings-nav.ts`

**What to extract:**
- `SettingsNavItem` type
- `SettingsNavGroup` type
- `SETTINGS_NAV_GROUPS` constant array

This is pure data — Lucide icon references + href strings + labels. Zero framework deps.

### T01-E: Extract `UserMenu` to SDK

**Source file:** `client-apps/web/src/domain/_shared/layout/UserMenu.tsx`

**Target:** `sdk/react/src/user/UserMenu.tsx`

**What to extract:**
- User avatar component
- Color scheme submenu (light/dark/system — NO preset picker)
- Menu structure with Settings, Appearance, Sign out items

**Props (callback-based, framework-agnostic):**
```typescript
interface UserMenuProps {
  user: { name?: string; email?: string } | null;
  onSettingsClick?: () => void;
  onSignOut?: () => void;
  /** Extra menu items rendered before sign out (e.g. "Get Desktop App" in web) */
  extraItems?: React.ReactNode;
}
```

**Color mode management:**
- Use `useColorMode()` already exported from `@stigmer/react` for the color scheme submenu
- Remove `next-themes` dependency — the SDK's own color mode context handles this
- Remove the preset picker submenu entirely

**Framework abstraction:**
- Replace `next/link` for Settings link with `onSettingsClick` callback
- Replace `next-themes` `useTheme()` with SDK's `useColorMode()`
- Use `@base-ui/react` Menu primitives for the dropdown

## Verification Criteria

After T01 is complete:

- [ ] `sdk/react/src/organization/` contains `OrgProvider.tsx`, `useOrgGate.ts`, `OrgSwitcher.tsx`
- [ ] `sdk/react/src/settings/` contains `settings-nav.ts`
- [ ] `sdk/react/src/user/` contains `UserMenu.tsx`
- [ ] All new exports added to `sdk/react/src/index.ts`
- [ ] Desktop app compiles and runs with SDK's `OrgProvider` (replacing its own)
- [ ] Web app compiles and runs with SDK's `OrgProvider` (replacing its own)
- [ ] Both apps' `OrgGate` components use `useOrgGate()` from SDK
- [ ] `make check` passes for both apps

## Risk Mitigation

1. **Import path changes**: Use find-and-replace carefully; both apps have different import conventions (`@/domain/_shared/org/org-context` vs `../../org/OrgProvider`)
2. **`@base-ui/react` API surface**: Verify that the SDK's direct usage of `@base-ui/react` Menu/Dialog doesn't conflict with the web's thin wrappers
3. **Color mode regression**: Verify that removing `next-themes` from UserMenu doesn't break the web's color mode behavior — the SDK's `useColorMode()` must provide the same functionality

## Next Task Preview

**T02: Desktop App Shell Rebuild** — Using the extracted SDK components, rebuild the desktop app shell with OrgSwitcher, ManagementSidebar, UserMenu, missing settings pages, settings landing page, sidebar collapse, and library breadcrumbs.

**T03: Web App Migration** — Migrate the web app to consume the SDK-extracted components, eliminating its local duplicates.
