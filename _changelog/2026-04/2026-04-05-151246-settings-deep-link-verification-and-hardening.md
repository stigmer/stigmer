# Settings Deep-Link Verification and Hardening

**Date**: April 5, 2026

## Summary

Verified that deep-linking to settings sub-pages (`/settings/api-keys`, `/settings/members`, `/settings/environments`) works correctly on cold load, and hardened the settings routes with scoped error and loading boundaries so deep-linked users don't lose ManagementSidebar context on failure.

## Problem Statement

Phase 5 of the settings layout refactor required verifying that deep-linking — opening a settings sub-page URL directly in the browser — renders the correct page with the ManagementSidebar, not the agent zone sidebar. Without verification, subtle bugs in zone detection, provider initialization, or auth redirect flow could strand users on wrong pages or lose navigation context.

### Pain Points

- No settings-specific error boundary: if a section component threw, the root `error.tsx` replaced the entire page including the ManagementSidebar, leaving the user with no way to navigate to other settings pages.
- No settings-specific loading boundary: sub-page transitions had no intermediate loading state within the settings layout.
- The OIDC auth redirect flow needed verification that it preserves the original deep-link URL through the full auth round-trip.

## Solution

Conducted a thorough code analysis of the deep-link path (auth flow, zone detection, provider chain, sidebar initialization) supplemented by browser testing and static export verification. Found the architecture structurally sound with no bugs. Added two hardening files to improve resilience.

## Implementation Details

### Code Analysis Findings (All Correct)

- **Zone detection**: `AppShell.tsx` uses `pathname.startsWith("/settings")` via `usePathname()`, which returns the browser's current URL on cold load.
- **Auth flow**: `OidcAuthProvider.login()` stores the full path + query string in `sessionStorage` before redirecting to Auth0. After callback, `window.location.replace(savedPath)` restores the deep-link.
- **SessionNavigationProvider**: Initializes with `isSessionZone = false` for `/settings/*` paths. No stale session state.
- **ManagementSidebar active link**: `pathname === item.href || pathname.startsWith(item.href + "/")` highlights correctly for all three sub-pages.
- **Provider chain**: Route-agnostic. Settings pages go through the same `ConfigGate -> AuthProvider -> AuthGuard -> QueryClient -> StigmerTransportBridge -> OrgProvider -> OrgGate` chain.

### New Files

**`app/settings/error.tsx`** — Settings-scoped error boundary that renders inside the settings layout (preserving ManagementSidebar). Uses `classifyError`/`getUserMessage` from `@stigmer/sdk` for consistent error categorization. Provides "Try again" and "Go to Members" navigation.

**`app/settings/loading.tsx`** — Settings-scoped loading boundary (spinner) for sub-page transitions. Keeps ManagementSidebar visible during loading.

### Static Export Verification

Built with `output: "export"` and confirmed all four HTML files generated: `settings.html`, `settings/api-keys.html`, `settings/members.html`, `settings/environments.html`. The `/settings` redirect uses Next.js 16's RSC-level redirect mechanism (`NEXT_REDIRECT;replace;/settings/members;307`), handled client-side during hydration.

## Benefits

- Deep-linked users who hit an error in a settings section stay within the management zone with full sidebar navigation — they can retry or navigate to other settings pages.
- Loading transitions between settings sub-pages show a contextual spinner instead of a blank page.
- Verified that the OIDC auth flow correctly preserves deep-link URLs, giving confidence in the auth redirect chain.

## Impact

- **Console users**: Improved error recovery experience when deep-linking to settings pages.
- **Architecture**: No changes to existing components (ManagementSidebar, AppShell, SessionNavigationProvider). The deep-linking architecture from Phase 1-4 is confirmed sound.
- **SDK packages**: No changes — error/loading boundaries are Console-only routing concerns.

## Related Work

- Settings layout refactor (Phase 1-4): `7945cde5` — created ManagementSidebar, zone detection, route restructure
- Project: `_projects/2026-04/20260405.03.settings-layout-refactor/`

---

**Status**: ✅ Production Ready
