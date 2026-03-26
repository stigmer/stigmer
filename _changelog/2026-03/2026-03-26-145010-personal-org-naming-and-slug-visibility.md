# Personal Org Naming and Slug Visibility

**Date**: March 26, 2026

## Summary

Personal organizations now use the static display name "Personal" instead of the user's Auth0 profile name, mirroring the Daytona pattern. The OrgSwitcher in the Console now shows the org slug alongside the display name for all organizations, making the canonical identifier always visible.

## Problem Statement

Personal org names were derived from Auth0 user profiles (full name, given+family, or email local part), which provided no consistent identity signal. Since the slug/ID is the canonical value used everywhere -- agent definitions, resource references, CLI commands, API calls -- hiding it behind a display-name-only UI forced users to look it up elsewhere.

### Pain Points

- Personal orgs named "Suresh Attaluri" gave no signal that it was a personal org vs a team org with a person's name
- The org slug (which equals the org ID) was invisible in the sidebar and org switcher
- Users had to navigate elsewhere to find the slug needed for resource configuration
- The Auth0 Management API was called during personal org creation solely for display name resolution -- an unnecessary external dependency

## Solution

Adopted the Daytona approach: all personal organizations are named "Personal", and the slug is surfaced as secondary text alongside the display name in the OrgSwitcher for every org (personal and team).

## Implementation Details

### Backend (stigmer-cloud)

- **`PersonalOrganizationActivitiesImpl`**: Replaced `resolveDisplayName()` chain (Auth0 full name -> given+family -> email local part) with a static `PERSONAL_ORG_DISPLAY_NAME = "Personal"` constant
- Removed `resolveDisplayName` and `emailLocalPart` private methods
- Removed `UserOnAuth0Getter` dependency from the class (was only used for display name resolution)
- Constructor narrowed from `(OrganizationGrpcRepo, UserOnAuth0Getter, MongoTemplate)` to `(OrganizationGrpcRepo, MongoTemplate)`

### Backend Tests (stigmer-cloud)

- Replaced the 5-test "Display name resolution" suite with a single test asserting name is always "Personal"
- Removed all `UserOnAuth0Getter` mock setups across idempotency and slug-retry tests
- Updated `buildCreatedOrg` helper to return "Personal" as the org name

### Frontend (stigmer)

- **`OrgSwitcher.tsx`**: Extracted `OrgLabel` component showing org name (primary, `text-sm font-medium`) and slug (secondary, `text-xs` muted) in a two-line layout
- Applied to both the sidebar trigger button and dropdown menu items for all orgs
- Icons and chevrons aligned to top of the two-line layout with `self-start mt-0.5`

### Data Backfill

A manual MongoDB script is provided to rename existing personal orgs:

```javascript
db.organization.updateMany(
  { "spec.isPersonal": true },
  { $set: { "metadata.name": "Personal" } }
)
```

## Benefits

- **Clarity**: Personal orgs are immediately identifiable as "Personal" (Daytona pattern)
- **Slug visibility**: The canonical identifier is always visible in the sidebar, eliminating guesswork when referencing orgs in agent configs or API calls
- **Simpler backend**: Removed Auth0 Management API dependency from personal org creation path, reducing external calls and potential failure modes
- **Consistent UX**: Both personal and team orgs get the same name+slug two-line treatment

## Impact

- **Users**: See "Personal" + slug in the org switcher; slug is now discoverable without leaving the sidebar
- **Backend**: `PersonalOrganizationActivitiesImpl` is smaller and no longer depends on `UserOnAuth0Getter`
- **Existing data**: Requires a one-time manual MongoDB update to rename existing personal orgs

## Related Work

- Builds on the auto-personal-org project (`20260325.01.auto-personal-org`) which introduced `is_personal` and server-side personal org creation
- Inspired by Daytona's "Personal" org labeling pattern observed in their dashboard UI

---

**Status**: Production Ready
**Timeline**: ~1 hour
