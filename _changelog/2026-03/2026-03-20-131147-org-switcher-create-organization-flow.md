# Organization Switcher: Create Organization Flow

**Date**: March 20, 2026

## Summary

Added the ability to create organizations directly from the sidebar org switcher dropdown. Previously, the org switcher only allowed switching between existing organizations with no way to create new ones from the web UI. The implementation follows SDK-first architecture: behavior hook and styled form in `@stigmer/react`, Dialog primitive and switcher integration in the Console.

## Problem Statement

The organization context switcher in the sidebar showed a list of organizations with radio selection but offered no create action. Users who needed to create a new organization had no path to do so from the web console — they would have had to use the CLI or API directly.

### Pain Points

- Zero-org users saw a dead-end "No organizations" label with no way forward
- Single-org users saw static text with no dropdown, hiding any potential actions
- The `OrganizationClient.create()` method existed in the TypeScript SDK but had no React hook or form component
- No Dialog UI primitive existed in the component library, blocking modal-based create flows

## Solution

Five-layer implementation following the established SDK-first architecture and the `CreateEnvironmentForm` precedent:

1. **SDK behavior hook** (`useCreateOrganization`) — wraps `organization.create()` with loading/error state
2. **SDK styled form** (`CreateOrganizationForm`) — compact form collecting name and description
3. **Console Dialog primitive** — reusable modal built on `@base-ui/react/dialog`
4. **OrgContext enhancement** — `refresh(targetSlug?)` for post-creation refetch with auto-select
5. **OrgSwitcher enhancement** — always shows dropdown with separator + "Create organization" item, opening a Dialog on click

## Implementation Details

### SDK Layer (`@stigmer/react`)

New `organization/` module with two files:

- `useCreateOrganization.ts` — Behavior hook following the exact `useCreateEnvironment` pattern. Returns `{ create, isCreating, error, clearError }`. Calls `stigmer.organization.create(input)` via the Stigmer client from `useStigmer()`.

- `CreateOrganizationForm.tsx` — Styled form component with `onCreated` and `onCancel` callbacks. Collects `name` (required) and `description` (optional). Auto-derives the `org` field from the name for the bootstrap create operation. All styles via semantic Tailwind classes compatible with `--stgm-*` tokens.

Both are exported from the top-level `@stigmer/react` barrel for platform builders.

### Console Layer (`client-apps/web`)

- **Dialog primitive** (`components/ui/dialog.tsx`) — Built on `@base-ui/react/dialog` following the same wrapper pattern as `dropdown-menu.tsx`. Exports `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`, `DialogTitle`, `DialogDescription`. Includes backdrop overlay and enter/exit animations. This primitive has immediate reuse value for HITL approval gates, confirmation dialogs, and other modal flows.

- **OrgContext** (`contexts/org-context.tsx`) — `load()` function now accepts an optional `targetSlug` parameter. When provided, it overrides the localStorage-persisted slug for auto-selection. Exposed as `refresh` on the context interface alongside the existing `retry`.

- **OrgSwitcher** (`components/layout/OrgSwitcher.tsx`) — Always renders a dropdown now (including zero-org and single-org cases). After the radio group, a `DropdownMenuSeparator` and "Create organization" `DropdownMenuItem` appear. Clicking it opens a Dialog containing `CreateOrganizationForm`. On success, the org list refreshes and the new org is auto-selected.

## Benefits

- Users can create organizations directly from the sidebar without leaving their current context
- Zero-org users now have a clear path forward instead of a dead-end label
- Single-org users can access org actions (previously hidden behind a static display)
- Platform builders get `useCreateOrganization` and `CreateOrganizationForm` for embedding org creation in their own products
- The Dialog primitive is available for other modal flows across the Console

## Impact

- **Direct users**: New organization creation flow accessible from the sidebar on every page
- **Platform builders**: New hook and form component exported from `@stigmer/react` for embedding
- **Codebase**: New reusable Dialog primitive; org context now supports targeted refresh

## Related Work

- Environment creation flow (`CreateEnvironmentForm`, `useCreateEnvironment`) — served as the architectural template
- Settings page environment management — same inline form pattern for environments

---

**Status**: Production Ready
**Timeline**: Single session
