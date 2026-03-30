# Client-Side Library Navigation — Eliminate Full-Page Reloads in Library Zone

**Date**: March 30, 2026

## Summary

Extended the client-side session routing pattern to the library zone, eliminating every remaining full-page reload in the Console. Library list-to-detail, detail-to-related-detail, and back-to-list transitions now use `history.pushState` + React state, matching the flicker-free session switching experience shipped earlier today. Also fixed a gap in `SessionNavigationProvider` where re-entering the session zone via `<Link>` (e.g., from error pages) rendered a blank placeholder instead of `SessionZoneContent`.

## Problem Statement

After the session zone was fixed with `SessionNavigationProvider`, the library zone (`/library/*`) still used `navigateTo()` — a `window.location.href` wrapper — for all internal navigation. Every click from a resource list to a detail page, and every cross-link between detail pages, triggered a full document reload.

### Pain Points

- Every library navigation reloaded auth, config, org data, sidebar, and the SDK client from scratch
- Search queries, filter selections, scope toggles, and scroll position in list pages were lost after viewing a detail page and pressing back
- The experience was inconsistent: session switching felt instant while library browsing felt sluggish
- Cross-links from an agent detail page to a related MCP server or skill caused the same full reload
- `<Link href="/">` from error/not-found pages rendered a blank placeholder instead of the session launcher because `SessionNavigationProvider` only handled *leaving* the session zone, never *re-entering* it

### Root Cause

Same as the session zone: Next.js static export (`output: "export"`) cannot soft-navigate to dynamic routes not pre-rendered by `generateStaticParams()`. The library detail pages (`/library/agents/[org]/[slug]`, etc.) only pre-render a `__placeholder__` page, so `navigateTo()` was used as a workaround — causing full document navigations.

## Solution

A `LibraryNavigationProvider` context that manages detail-page navigation entirely via React state + `history.pushState`. The library layout, breadcrumbs, and list pages all stay mounted across detail transitions.

## Implementation Details

### New File

- **`client-apps/web/src/contexts/library-navigation.tsx`** — Context provider with `activeDetail` state (tracking `resourceType`, `org`, `slug`), `navigateToDetail()` and `clearDetail()` methods. Syncs URL via `pushState`, handles browser back/forward via `popstate`, and detects Next.js `<Link>` navigations away from the library zone via `usePathname()`. Exposes `currentLibraryPath` for breadcrumb derivation.

### Modified Files

- **`library/layout.tsx`** — Wraps content with `LibraryNavigationProvider`. Extracted `LibraryLayoutContent` that reads `activeDetail` from context: when set, hides `{children}` (list page) with CSS `hidden` and renders `LibraryDetailContent`; when null, renders `{children}` normally. This preserves list page state (scroll position, filters, search) across detail navigation — the same pattern as `SessionZoneContent` hiding `SessionLauncher`.

- **`AgentDetailPage.tsx`** — Extracted `AgentDetailPageInner` accepting `org`/`slug` as props for direct use by `LibraryDetailContent`. Replaced `navigateTo()` cross-links (`onMcpServerClick`, `onSkillClick`) with `navigateToDetail()`. Original `AgentDetailPage` kept as thin wrapper using `useStaticRouteParam` for direct URL access.

- **`SkillDetailPage.tsx`** — Same extraction: `SkillDetailPageInner` exported with prop-based params.

- **`McpServerDetailPage.tsx`** — Same extraction: `McpServerDetailPageInner` exported with prop-based params.

- **`AgentListPage.tsx`** — Replaced `navigateTo()` with `navigateToDetail("agents", ...)` from context.

- **`SkillListPage.tsx`** — Replaced `navigateTo()` with `navigateToDetail("skills", ...)` from context.

- **`McpServerListPage.tsx`** — Replaced `navigateTo()` with `navigateToDetail("mcp-servers", ...)` from context.

- **`LibraryLanding.tsx`** — Removed `onClick` handler that called `navigateTo()` on resource cards. These navigate to static routes (`/library/agents`, etc.) that Next.js handles correctly with native `href`.

- **`LibraryBreadcrumb.tsx`** — Switched from raw `usePathname()` to `currentLibraryPath` from the navigation context, ensuring breadcrumbs reflect the pushState-driven detail URL.

- **`session-navigation.tsx`** — Added re-entry detection: when `usePathname()` changes to a session-zone path while `isSessionZone` is false, the provider now restores `isSessionZone = true` and parses the session ID. Fixes the blank placeholder bug when navigating to `/` via `<Link>` from error/not-found pages.

### Deleted File

- **`client-apps/web/src/utils/navigation.ts`** — Zero remaining consumers after migration. The `navigateTo()` workaround is no longer needed.

### Key Design Decision: List Page State Preservation

When a detail page is active, the library layout hides the list page with CSS `hidden` + `aria-hidden` rather than unmounting it. This means scroll position, search queries, filter selections, and scope toggles survive round-trip navigation to detail pages and back — matching the session zone pattern where `SessionLauncher` stays mounted but hidden when viewing a session.

## Benefits

- **Zero full-page reloads** anywhere in the Console when navigating between library resources
- **List page state preserved** — filters, search, scope, scroll position survive detail navigation and back
- **Instant detail navigation** — only the content area re-renders; sidebar, auth, org, theme, breadcrumbs all stay mounted
- **Browser back/forward works** — `popstate` handler keeps URL and state in sync
- **Accessibility preserved** — `<a href>` attributes retained for right-click, Cmd+click, middle-click
- **Session zone re-entry fixed** — `<Link href="/">` from error/not-found pages now correctly renders the session launcher
- **Zero SDK changes** — all changes are Console-only (`client-apps/web`), no impact on `@stigmer/react` or `@stigmer/sdk`

## Impact

- **End users**: Noticeably faster, flicker-free library browsing with preserved list state
- **Platform builders**: No impact — all changes are in Console; SDK packages untouched
- **Architecture**: Completes the client-side routing pattern across both zones (sessions and library), establishing `pushState` + React state as the standard for all dynamic-route navigation in the static-export Console

## Related Work

- [Client-Side Session Routing](2026-03-30-104336-client-side-session-routing.md) — the session zone implementation this work mirrors
- Nginx SPA fallback configuration (unchanged, still serves `__placeholder__.html`)
- Static export deployment model (unchanged, `output: "export"` retained)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
