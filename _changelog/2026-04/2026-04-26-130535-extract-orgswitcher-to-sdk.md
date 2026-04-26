# Extract OrgSwitcher Component to @stigmer/react SDK

**Date**: April 26, 2026

## Summary

Extracted the `OrgSwitcher` dropdown component from the web console into `@stigmer/react`, enabling both the web and desktop apps to consume the same org-switching UI from the SDK. Introduced SDK-internal Menu primitives as a shared styling layer for `@base-ui/react` menus, and added `@base-ui/react` to the desktop app's dependency graph in preparation for the desktop shell rebuild.

## Problem Statement

The Stigmer web console had an `OrgSwitcher` component that allowed users to view their active organization, switch between organizations, and create new ones. The desktop app had no equivalent — just a static "Stigmer" label in the sidebar header. This is part of the larger desktop/web UX parity gap.

### Pain Points

- Desktop users could not switch organizations without using the web console
- The OrgSwitcher's behavior logic (`useOrg()`, `CreateOrganizationForm`) was already in the SDK from prior extractions (T01-A), but the UI component itself was web-only
- The component depended on web-local `dropdown-menu.tsx` and `dialog.tsx` wrappers, preventing direct reuse

## Solution

Extracted the OrgSwitcher as a styled SDK component with a clean props API, created SDK-internal Menu primitives for shared dropdown styling, and migrated the web app to consume the SDK component.

## Implementation Details

### SDK-Internal Menu Primitives (`sdk/react/src/internal/menu.tsx`)

Created a non-exported, SDK-internal styled wrapper over `@base-ui/react/menu` — providing a single source of truth for dropdown menu styling across SDK components. Includes `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuRadioGroup`, `MenuRadioItem`, and `MenuSeparator`. Both `OrgSwitcher` (T01-C) and the upcoming `UserMenu` (T01-E) will consume these.

### OrgSwitcher Component (`sdk/react/src/organization/OrgSwitcher.tsx`)

Ported from the web's implementation with these enhancements:

- **Props API**: `OrgSwitcherProps` with `onOrgChanged?` (fires only on user-initiated org changes) and `className?`
- **Token context correctness**: Trigger uses `sidebar-*` tokens (its natural rendering context), portaled dropdown uses `popover-*`/main-area tokens. Fixed a latent bug where the web's OrgLabel used sidebar tokens inside the portaled dropdown.
- **Inline Dialog**: The "Create organization" dialog uses `@base-ui/react/dialog` directly (~30 lines) rather than a shared wrapper — only one consumer, no premature abstraction.

### Web Migration

Updated `Sidebar.tsx` and `ManagementSidebar.tsx` to import from `@stigmer/react`. Deleted the web's local `OrgSwitcher.tsx` (179 lines removed).

### Desktop Preparation

Added `@base-ui/react: ^1.0.0` to `client-apps/desktop/package.json`. The desktop app will render the SDK OrgSwitcher in its sidebar during T02 (Desktop App Shell Rebuild).

## Benefits

- **Single source of truth**: One OrgSwitcher component in the SDK, consumed by both web and desktop
- **Platform builder ready**: Platform builders integrating Stigmer can now use `<OrgSwitcher />` for org switching in their own applications
- **Visual consistency**: SDK-internal Menu primitives ensure all SDK dropdown menus look identical
- **Token correctness**: Proper sidebar-*/popover-* token separation prevents theming bugs in high-contrast presets

## Impact

- **SDK (`@stigmer/react`)**: 2 new files, 2 updated barrel exports — `OrgSwitcher` and `OrgSwitcherProps` are now part of the public API surface
- **Web console**: Import changes in 2 files, 1 file deleted — zero behavioral change, same visual output
- **Desktop app**: Dependency change only — UI integration happens in T02

## Related Work

- T01-A: Extracted `OrgProvider`, `useOrg`, `useActiveOrgSlug` to SDK (Session 1)
- T01-B: Extracted `useOrgGate()` behavior hook to SDK (Session 2)
- T01-D (next): Move `SETTINGS_NAV_GROUPS` to SDK
- T01-E (upcoming): Extract `UserMenu` to SDK — will consume the same internal Menu primitives

---

**Status**: Production Ready
**Timeline**: ~30 minutes (planning + implementation + verification)
