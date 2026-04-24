# Console: Smart Nudge Banner for Desktop App (T10)

**Date**: April 24, 2026

## Summary

Added a one-time dismissible desktop app promotion banner to the Console's AppShell. The banner uses a visit-based trigger (hidden on first visit, visible on returning visits) and renders as a thin announcement bar at the top of the main content area across all authenticated zones. This completes the three-surface Console promotion strategy: user menu (T08), contextual runner promo (T09), and global nudge (T10).

## Problem Statement

T08 and T09 delivered discoverable promotion surfaces, but both require the user to navigate to a specific location (user menu or Settings > Runners). Users who primarily use the session zone may never encounter these. A global, proactive nudge is needed to surface the desktop app to returning users.

### Pain Points

- Users who stay in the session zone may never open the user menu or visit Settings > Runners
- No mechanism to proactively surface the desktop app to returning users
- First-time users should not be overwhelmed with promotions during onboarding

## Solution

A thin announcement bar rendered in a new "banner slot" in AppShell's main content area. The banner appears on the user's second+ visit (visit-based post-value trigger) and disappears permanently when dismissed. The implementation introduces a structural layout change to AppShell that creates a reusable banner slot for future use.

## Implementation Details

### New file: `client-apps/web/src/domain/_shared/layout/DesktopAppBanner.tsx`

**`useDesktopBannerState()` hook**: Uses `useSyncExternalStore` over localStorage, matching the established sidebar pattern in `use-layout-state.tsx`. Two localStorage keys:

- `stigmer:desktop-banner-first-seen` — ISO timestamp, seeded on first visit via `useEffect`
- `stigmer:desktop-banner-dismissed` — `"true"`, set when user clicks dismiss

The snapshot function is read-only (returns `true` when first-seen exists AND dismissed is absent). Server snapshot returns `false` to avoid hydration mismatch. Storage event dispatch on dismiss triggers reactive re-render, including cross-tab sync.

**`DesktopAppBanner` component**: Semantic `<aside role="complementary">` with `Monitor` icon, "Stigmer Desktop" title + value prop copy, "Download" external link with `ArrowUpRight` (same convention as T08/T09), and dismiss X button. Uses main-area tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border-muted`).

### Modified: `client-apps/web/src/domain/_shared/layout/AppShell.tsx`

Structural change to `<main>`: converted from scroll container (`overflow-y-auto`) to flex-column parent (`flex flex-col overflow-hidden`). Existing content wrapped in `<div className="min-w-0 flex-1 overflow-y-auto">`. Banner renders above the inner scroll div. Public zone branch unchanged.

### Design decisions

- **Visit-based trigger over session-based**: No infrastructure to detect "first session" at AppShell level without API calls. A returning user is a strong post-value proxy. Works in both local and cloud mode.
- **Top-of-main placement over fixed bottom**: Fixed bottom bar would overlap the session composer. Toast is too transient. Flex-column with banner slot is a standard layout pattern.
- **All authenticated zones**: One-time nudge justifies maximum visibility. Session + management zones included. Public zone excluded.
- **`useSyncExternalStore` over `useState`**: Avoids hydration mismatch, handles cross-tab sync, matches the established sidebar pattern.

## Benefits

- Returning users are proactively informed about Stigmer Desktop without navigating to specific pages
- First-time users are not overwhelmed (banner hidden on first visit)
- Permanent dismissal respects user preference (DD-04: no recurring banners)
- Banner slot in AppShell is reusable for future global announcements
- Zero API calls for trigger detection

## Impact

- **Console users**: Returning users see a one-time, non-intrusive nudge for the desktop app
- **AppShell layout**: `<main>` structural change from scroll container to flex-column parent. Content behavior unchanged (inner div inherits scroll). Creates a reusable pattern.
- **localStorage**: Two new keys added (`stigmer:desktop-banner-first-seen`, `stigmer:desktop-banner-dismissed`)

## Related Work

- T08: Console "Get Desktop App" in user menu (`UserMenu.tsx`, `external-links.ts`)
- T09: Console contextual runner promotion (`RunnersSection.tsx`)
- T06: Marketing site `/download` page with platform detection
- Project: `20260424.01.desktop-app-promotion` — Phase B distribution & promotion

---

**Status**: Production Ready
**Timeline**: Single session
