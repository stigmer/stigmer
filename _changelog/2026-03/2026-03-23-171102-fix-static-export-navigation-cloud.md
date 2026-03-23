# Fix Static Export Navigation for Cloud Deployment

**Date**: March 23, 2026

## Summary

Fixed silent navigation failures across the entire Console when deployed as a Next.js static export on the cloud. Two interrelated problems: (1) Next.js soft navigation (`router.push`, `<Link>`) fetched RSC flight data that doesn't exist for dynamic routes, causing silent failure; (2) Nginx's SPA fallback served the root `index.html` (home page HTML) instead of the correct page's HTML on full page loads to dynamic routes. Fixed both: replaced soft navigation with full page loads via a centralized `navigateTo()` utility, and added a regex-based Nginx dynamic-route fallback that automatically serves the correct `__placeholder__.html` for any dynamic route.

## Problem Statement

After submitting a new session on the cloud-deployed Console, the page stayed on the home screen — the submit button reset, text cleared, but no navigation occurred. No errors were visible in the frontend or backend.

### Pain Points

- Clicking "submit" on the session launcher created the session and execution successfully on the backend, but the frontend never navigated to the session view
- Sidebar session links (recents list) were also broken — clicking them did nothing
- Library pages (agents, skills, MCP servers) had the same silent failure when clicking into detail views
- The issue only occurred on the cloud deployment, not in local development
- No error messages, no console warnings — completely silent failure

## Solution

Two complementary fixes:

1. **Frontend**: Replaced Next.js soft navigation (`router.push`, `<Link>`) with full page navigation (`window.location.href`) for all dynamic routes in the Console via a centralized `navigateTo()` utility. Static routes (`/`, `/library`) retain `<Link>` since they have pre-rendered RSC data and work correctly.

2. **Nginx**: Added a regex-based dynamic-route fallback (`location ~ ^(.+)/[^/]+$`) that serves the `__placeholder__.html` from the parent directory instead of the root `index.html`. This ensures full page loads to dynamic routes hydrate the correct page component. The regex is self-maintaining — new dynamic routes that follow the `generateStaticParams` + `__placeholder__` convention work automatically without touching `nginx.conf`.

## Implementation Details

**Root cause** (two layers):

1. **Soft navigation failure**: The App Router's soft navigation requires RSC flight data files for each route. Only routes pre-rendered by `generateStaticParams` have these files — all dynamic routes return only `[{ id: "__placeholder__" }]`. When `router.push` triggers, Next.js fetches RSC data at a path that doesn't exist, and silently aborts the navigation.

2. **Wrong page on full page load**: Nginx's generic SPA fallback (`try_files ... /index.html`) served the root `index.html` — the **home page** HTML — for all unmatched paths. Next.js hydrated the home page component even though the URL showed `/sessions/ses_abc`. Each static export page has its own HTML file; falling back to the root always renders the home page.

**Changes**:

- **New**: `client-apps/web/src/utils/navigation.ts` — `navigateTo(path)` utility wrapping `window.location.href`
- **nginx.conf** — Added `location ~ ^(.+)/[^/]+$` regex block with `$1/__placeholder__.html` fallback; added `^~` to `/_next/static/` for correct priority
- **SessionLauncher.tsx** — `router.push` replaced with `navigateTo`, `useRouter` removed
- **Sidebar.tsx** — `<Link>` replaced with `<a>` for dynamic session links; static route links (`/`, `/library`) kept as `<Link>`
- **AgentListPage.tsx** — `router.push` replaced with `navigateTo`, `useRouter` removed
- **SkillListPage.tsx** — `router.push` replaced with `navigateTo`, `useRouter` removed
- **McpServerListPage.tsx** — `router.push` replaced with `navigateTo`, `useRouter` removed
- **AgentDetailPage.tsx** — `router.push` replaced with `navigateTo`, `useRouter` removed (kept `useParams`)
- **LibraryLanding.tsx** — `router.push` replaced with `navigateTo`, `useRouter` removed

## Benefits

- Session creation now correctly navigates to the session view on cloud deployments
- All sidebar session links work on cloud deployments
- All library detail page navigation works on cloud deployments
- Single revert point if the deployment model changes to server-rendered
- Nginx regex fallback is self-maintaining — new dynamic routes just work
- No SDK or backend changes required

## Impact

- **Users**: All cloud-deployed Console users can now navigate to sessions and library detail pages
- **Scope**: Console-only (`client-apps/web`) — no SDK package changes
- **UX tradeoff**: Full page navigation causes a brief reload flash when navigating to dynamic routes; this is the correct behavior for a static export and preferable to silent failure

## Related Work

- Next.js static export configuration in `next.config.ts` (`output: "export"`)
- Nginx dynamic-route fallback in `nginx.conf` (`location ~ ^(.+)/[^/]+$`)
- `generateStaticParams` placeholder pattern in dynamic route pages
- Convention: all dynamic routes must use `__placeholder__` as the param value in `generateStaticParams` for the nginx regex to resolve correctly

---

**Status**: ✅ Production Ready
