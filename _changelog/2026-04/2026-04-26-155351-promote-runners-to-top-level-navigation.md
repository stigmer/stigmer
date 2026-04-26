# Promote Runners to Top-Level Navigation

**Date**: April 26, 2026

## Summary

Runners have been promoted from a Settings sub-page to a top-level navigation item alongside Sessions and Library in both the web console and desktop app. This reflects the Runner's role as a first-class operational resource — the compute backbone of the platform — rather than a configuration concern.

## Problem Statement

Runners were buried inside Settings > Infrastructure, requiring two clicks to reach. This placement misrepresented their role in the platform and created friction for users who interact with runners as part of their core workflow.

### Pain Points

- Runners are the compute backbone — every execution runs on a runner — yet they were hidden inside a settings sub-page
- Users select runners in the session composer but had no quick way to check runner health before starting a session
- The "Infrastructure" settings group existed solely for Runners, making it a category of one
- The placement treated an operational monitoring surface as a one-time configuration task

## Solution

Moved Runners to a top-level route (`/runners`) that uses the main sidebar, positioned after Library and before the Recents separator. Removed the "Infrastructure" group from `SETTINGS_NAV_GROUPS` in the SDK. Added backward-compatible redirects from the old `/settings/runners` path.

## Implementation Details

**SDK (`@stigmer/react`)**
- Removed the "Infrastructure" group from `SETTINGS_NAV_GROUPS` in `sdk/react/src/settings/settings-nav.ts`
- Both web and desktop `ManagementSidebar` components automatically stop rendering Runners in settings since they iterate this constant

**Web App**
- Added Runners link (with `Server` icon) to the main `Sidebar.tsx` after Library
- Created new top-level route at `client-apps/web/src/app/runners/page.tsx`
- Moved `RunnersSection` from `domain/settings/` to `domain/runner/` following domain-based organization
- Converted old `/settings/runners` page to a `redirect("/runners")` for backward compatibility

**Desktop App**
- Added Runners `NavLink` to the main `Sidebar.tsx` after Library
- Moved the `runners` route from `settings/runners` to a top-level child of `AppShell` in `routes.tsx`
- Added `<Navigate to="/runners" replace />` at the old `settings/runners` path for saved-route compatibility

**Sidebar order**: New Session, Library, Runners, [separator], Recents — following frequency-of-use ordering and conceptual flow (what to run > browse blueprints > where it runs).

## Benefits

- Runner health is visible in one click from anywhere in the app
- Navigation structure now reflects the domain model: Runner is an `agentic` resource, not a setting
- Settings sidebar is cleaner — only genuinely configuration-related groups remain (Organization, Configuration, Billing & Usage)
- Old bookmarks and deep links continue to work via redirects

## Impact

- **Direct users**: Faster access to runner management and monitoring
- **Platform builders**: `SETTINGS_NAV_GROUPS` no longer includes the Infrastructure group — builders embedding the settings navigation will see a cleaner list
- **Both web and desktop**: Consistent navigation structure across both client apps

## Related Work

- Desktop/web UX parity work (`2026-04-26-154337-desktop-web-ux-parity-complete.md`)
- SDK extraction of settings nav (`2026-04-26-133359-settings-nav-sdk-extraction.md`)

---

**Status**: ✅ Production Ready
