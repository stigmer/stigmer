# Org Profile Settings Page

**Date**: April 6, 2026

## Summary

Implemented the Organization Profile settings page following the SDK-first architecture. Built a `useOrganization` data hook, a `useUpdateOrganization` mutation hook, and an `OrgProfilePanel` styled component in `@stigmer/react`, then wired a thin Console section to consume it. The Org Profile page — previously a "Coming Soon" placeholder — now displays and allows editing of the organization's name, description, and logo URL.

## Problem Statement

The settings management zone had seven sidebar items, but only four were functional (Members, Identity Providers, API Keys, Environments). The Org Profile page showed a static "Coming Soon" placeholder, offering no value to users who navigated there.

### Pain Points

- No way to view or edit organization metadata (name, description, logo) from the web console
- The "Coming Soon" placeholder created a dead-end in the settings navigation
- The `@stigmer/react` SDK lacked data-fetch and update hooks for the Organization resource, meaning platform builders had no React-level API for org profile management

## Solution

Built the feature end-to-end across the three-layer SDK architecture:

1. **Data hook** (`useOrganization`) — fetches an Organization by ID with cancellation, loading state, error handling, and refetch
2. **Mutation hook** (`useUpdateOrganization`) — wraps `organization.update()` with loading/error state
3. **Styled component** (`OrgProfilePanel`) — self-contained profile editor that composes both hooks, themed via `--stgm-*` tokens, zero Console dependencies
4. **Console section** (`OrgProfileSection`) — thin wrapper connecting `OrgProvider` context to the SDK panel

## Implementation Details

### React SDK (`@stigmer/react`)

- **`useOrganization(id: string | null)`**: Follows the `useEnvironment` pattern — accepts `null` to skip, returns `{ organization, isLoading, error, refetch }`, uses `cancelled.current` for stale-request protection and `fetchKey` for imperative refetch.
- **`useUpdateOrganization()`**: Follows the `useUpdateIdentityProvider` pattern — returns `{ update, isUpdating, error, clearError }`. Takes `OrganizationInput` which uses `name/slug/org` for identification.
- **`OrgProfilePanel`**: Takes `orgId` and `onUpdated` callback. Displays read-only identifiers (slug with copy button, org ID with copy button, personal badge) and editable fields (name input, description textarea with character counter, logo URL with image preview). Tracks dirty state by comparing form values against the server snapshot. Save button disabled when no changes exist. Discard button resets to server state.

### Console (`client-apps/web`)

- **`OrgProfileSection`**: Gets `activeOrg` from `useOrg()`, passes `orgId` to `OrgProfilePanel`. On successful update, calls `refresh(slug)` to sync the sidebar org name.
- **`org-profile/page.tsx`**: Replaced `ComingSoon` with `OrgProfileSection`.

### Barrel exports

Updated both `sdk/react/src/organization/index.ts` and `sdk/react/src/index.ts` with the new hooks, component, and their type exports.

## Benefits

- **Users**: Can now view and edit organization name, description, and logo from the settings page
- **Platform builders**: Can embed `<OrgProfilePanel orgId="..." />` in their own dashboards — it fetches, displays, and saves organization profile data independently
- **SDK completeness**: `@stigmer/react` now has full Organization CRUD hooks (create existed previously; get and update are new)
- **Consistency**: Follows identical patterns to Identity Provider, Environment, and IAM Policy features — no new conventions introduced

## Impact

- **Settings pages**: 5 of 7 sidebar items now functional (Members, Identity Providers, API Keys, Environments, Org Profile). Only Billing and Usage remain as Coming Soon.
- **SDK surface**: 3 new exports from `@stigmer/react` (`useOrganization`, `useUpdateOrganization`, `OrgProfilePanel`) plus their TypeScript types
- **Zero breaking changes**: All additions are new exports; existing APIs unchanged

## Related Work

- Session 8: Added Org Profile as a placeholder nav item with `ComingSoon` component
- Session 9: Settings IA reorganization that grouped Org Profile under the "Organization" section
- Settings Layout Refactor project (`20260405.03`): This is Session 10 of that project

---

**Status**: Production Ready
**Timeline**: Single session implementation
