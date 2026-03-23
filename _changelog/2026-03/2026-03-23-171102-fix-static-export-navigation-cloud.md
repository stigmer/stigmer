# Fix Static Export Navigation for Cloud Deployment

**Date**: March 23, 2026

## Summary

Fixed silent navigation failures across the entire Console when deployed as a Next.js static export on the cloud. Client-side navigation (`router.push` and `<Link>`) to dynamic routes was silently failing because Nginx served HTML instead of the RSC flight data that the Next.js App Router expects. Replaced all affected navigation with full page loads via a centralized `navigateTo()` utility.

## Problem Statement

After submitting a new session on the cloud-deployed Console, the page stayed on the home screen — the submit button reset, text cleared, but no navigation occurred. No errors were visible in the frontend or backend.

### Pain Points

- Clicking "submit" on the session launcher created the session and execution successfully on the backend, but the frontend never navigated to the session view
- Sidebar session links (recents list) were also broken — clicking them did nothing
- Library pages (agents, skills, MCP servers) had the same silent failure when clicking into detail views
- The issue only occurred on the cloud deployment, not in local development
- No error messages, no console warnings — completely silent failure

## Solution

Replaced Next.js soft navigation (`router.push`, `<Link>`) with full page navigation (`window.location.href`) for all dynamic routes in the Console. Static routes (`/`, `/library`) retain `<Link>` since they have pre-rendered RSC data and work correctly.

A single `navigateTo()` utility centralizes the workaround so it can be reverted in one place if the Console later moves to a server-rendered deployment.

## Implementation Details

**Root cause**: The Console deploys as a Next.js static export (`output: "export"`) served by Nginx. The App Router's soft navigation requires RSC flight data files for each route. Only routes pre-rendered by `generateStaticParams` have these files — all dynamic routes return only `[{ id: "__placeholder__" }]`. When `router.push` triggers, Next.js fetches RSC data at a path that doesn't exist. Nginx's SPA fallback serves `index.html` (HTML) instead. Next.js receives HTML where it expected RSC payload and silently aborts the navigation.

**Changes**:

- **New**: `client-apps/web/src/utils/navigation.ts` — `navigateTo(path)` utility wrapping `window.location.href`
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
- No SDK, backend, or Nginx configuration changes required

## Impact

- **Users**: All cloud-deployed Console users can now navigate to sessions and library detail pages
- **Scope**: Console-only (`client-apps/web`) — no SDK package changes
- **UX tradeoff**: Full page navigation causes a brief reload flash when navigating to dynamic routes; this is the correct behavior for a static export and preferable to silent failure

## Related Work

- Next.js static export configuration in `next.config.ts` (`output: "export"`)
- Nginx SPA fallback in `nginx.conf` (`try_files $uri $uri.html $uri/ /index.html`)
- `generateStaticParams` placeholder pattern in dynamic route pages

---

**Status**: ✅ Production Ready
