# OAuth Apps Settings Page + BYOA Dialog Fix

**Date**: April 13, 2026

## Summary

Added centralized visibility for org-level OAuth app configurations by introducing a new "OAuth Apps" page under Settings > Configuration, backed by SDK-first hooks and a styled component. Also fixed the BYOA dialog positioning bug where the "Use your own OAuth app" form rendered in the top-left corner instead of centered.

## Problem Statement

After completing the OAuth BYOA integration (T01-T07), org admins had no centralized way to see which OAuth apps their organization had configured. The BYOA UI existed only in-context on individual MCP server detail pages. Additionally, the native `<dialog>` element used for the BYOA form was mispositioned due to Tailwind CSS v4 preflight stripping the browser's default `margin: auto`.

### Pain Points

- No "OAuth Apps" entry in the Settings sidebar — admins had to navigate to each MCP server individually to check BYOA status
- The "Use your own OAuth app" dialog appeared in the top-left corner of the viewport instead of centered, creating a jarring UX

## Solution

### BYOA Dialog Fix

Added `m-auto` to the `<dialog>` element's className in `McpServerDetailView.tsx`. Tailwind v4's preflight resets all margins to `0`, which strips the `margin: auto` that browsers apply to modal `<dialog>` elements for centering. The single-class fix restores viewport centering.

### OAuth Apps Settings Page

Built following the platform's SDK-first architecture:

1. **SDK layer** (`@stigmer/react`): New `oauth-app/` module with `useOAuthAppList` data hook wrapping `stigmer.oauthapp.listByOrg()` and `OAuthAppListPanel` styled component
2. **Console layer** (`client-apps/web`): New `/settings/oauth-apps` route with `OAuthAppsSection` wrapper, plus navigation entry under the Configuration group

## Implementation Details

### SDK: `sdk/react/src/oauth-app/`

- **`useOAuthAppList(org)`** — Data hook that fetches all OAuthApp resources for an org. Returns `{ oauthApps, isLoading, error, refetch }`. Skips fetch when `org` is null. Uses `stigmer.oauthapp.listByOrg()` from the generated TypeScript client.
- **`OAuthAppListPanel`** — Styled component rendering a read-only list of OAuth apps with provider name, client ID, and creation date. Includes loading skeleton, error state, and empty state. Themed entirely with `--stgm-*` tokens.

### Console: Settings page and navigation

- **`settings-nav.ts`** — Added `AppWindow` icon import and "OAuth Apps" entry under Configuration group. Updated group description to reflect OAuth apps.
- **`OAuthAppsSection.tsx`** — Thin Console wrapper providing org context and cloud-feature gating via `useResourceAvailable(ApiResourceKind.oauth_app)`.
- **`settings/oauth-apps/page.tsx`** — One-line route page following existing settings page pattern.

### Bug fix: `McpServerDetailView.tsx`

Single class addition (`m-auto`) to the BYOA `<dialog>` element, restoring browser-default centering behavior stripped by Tailwind v4 preflight.

## Benefits

- **Admin visibility**: Org admins can now see all their BYOA OAuth apps in one place under Settings > Configuration > OAuth Apps
- **SDK-first**: `useOAuthAppList` and `OAuthAppListPanel` are available to platform builders via `@stigmer/react` — a third-party dashboard can embed the same list
- **Zero backend changes**: The `listByOrg` API already existed in the IAM OAuthApp query controller
- **Dialog UX fix**: The BYOA form now centers correctly in the viewport

## Impact

- **End users**: New settings page for OAuth app visibility; fixed dialog centering
- **Platform builders**: New `useOAuthAppList` hook and `OAuthAppListPanel` component in the public SDK surface
- **Files changed**: 1 modified (bug fix) + 4 new (SDK) + 2 new (Console) + 1 modified (navigation)

## Related Work

- OAuth BYOA Integration (T01-T07) — `_projects/2026-04/20260413.01.oauth-byoa-integration/`
- This is a direct follow-up to the BYOA project, filling the gap of centralized admin visibility

---

**Status**: ✅ Production Ready
