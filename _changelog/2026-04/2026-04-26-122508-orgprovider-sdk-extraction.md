# Extract OrgProvider to @stigmer/react SDK

**Date**: April 26, 2026

## Summary

Extracted the duplicated `OrgProvider` component, `useOrg` hook, and `useActiveOrgSlug` hook from both the desktop and web client apps into `@stigmer/react`'s `organization` module. Both apps now consume org context from the shared SDK, eliminating identical code maintained in two places.

## Problem Statement

The desktop app (`client-apps/desktop/src/org/OrgProvider.tsx`) and web console (`client-apps/web/src/domain/_shared/org/org-context.tsx`) maintained near-identical implementations of organization context management — same localStorage key, same API call, same state shape, same race-condition guard. This violated DD-001 (SDK-first development) and created maintenance risk: a bug fix in one app would need to be manually mirrored in the other.

### Pain Points

- Identical ~180-line org context files in two separate apps
- Risk of behavioral drift between desktop and web org switching
- `CreateOrganizationForm` and `OrgProfilePanel` already lived in the SDK but couldn't share org context with the app shell
- Platform builders embedding full Stigmer panels had no SDK-provided org context

## Solution

Lifted the desktop's version (stricter `readonly` interface fields) into `sdk/react/src/organization/OrgProvider.tsx`, added it to barrel exports, then rewired all consumers in both apps to import from `@stigmer/react`.

## Implementation Details

- **New file**: `sdk/react/src/organization/OrgProvider.tsx` — `OrgProvider` component, `useOrg` hook, `useActiveOrgSlug` hook, exported `OrgContextValue` type
- **Updated barrels**: `sdk/react/src/organization/index.ts` and `sdk/react/src/index.ts`
- **Desktop**: Deleted local `OrgProvider.tsx`, updated 13 consumer files to import from `@stigmer/react`, consolidated duplicate import lines
- **Web**: Deleted local `org-context.tsx`, updated 21 consumer files to import from `@stigmer/react`, consolidated duplicate import lines
- **Dropped**: `useActiveOrg()` desktop-only alias with zero external consumers

Key design decisions:
- Kept `"use client"` directive for Next.js compatibility
- Used `readonly` on all `OrgContextValue` fields (matches SDK conventions)
- Error message follows DD-006: descriptive, actionable, references both `OrgProvider` and `StigmerProvider`
- SDK hook imports via `../hooks` (relative, internal); app imports via `@stigmer/react` (package)

## Benefits

- Single source of truth for org context across all Stigmer client apps
- Platform builders can now use `<OrgProvider>` + `useOrg()` from `@stigmer/react` for multi-org switching
- Zero behavioral change — same localStorage key, same API call, same state management
- Net deletion: 412 lines removed, 57 lines added across 39 files

## Impact

- **SDK consumers**: New public API surface — `OrgProvider`, `useOrg`, `useActiveOrgSlug`, `OrgContextValue`
- **Desktop app**: Import path changes only, no behavioral change
- **Web console**: Import path changes only, no behavioral change
- **Platform builders**: Can now build multi-org Stigmer integrations using SDK-provided org context

## Related Work

- Part of project 20260426.01.desktop-web-ux-parity (T01-A of 5 subtasks)
- Next: T01-B (useOrgGate extraction), T01-C (OrgSwitcher), T01-D (settings-nav), T01-E (UserMenu)
- Follows patterns established by existing SDK organization hooks (`useOrganization`, `useCreateOrganization`)

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes implementation + verification
